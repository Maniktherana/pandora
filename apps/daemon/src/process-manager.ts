import { randomUUID } from "node:crypto";
import { homedir } from "node:os";

import { logger } from "./logger";
import type {
  ActionCapabilities,
  AggregateStatus,
  AgentActivityState,
  AgentCliSignal,
  SessionDefinition,
  SessionInstance,
  SessionState,
  SessionStatus,
  SlotDefinition,
  SlotState,
} from "./types";

interface ManagedSession {
  definition: SessionDefinition;
  instance: SessionInstance;
  process: Bun.Subprocess | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  fgPollTimer: ReturnType<typeof setInterval> | null;
}

const FG_POLL_INTERVAL_MS = 2_000;

function defaultPandoraHome() {
  return process.env.PANDORA_HOME || `${homedir()}/.pandora`;
}

export function sessionSpawnEnv(
  definition: SessionDefinition,
  runtimeId: string,
  slotId: string,
): NodeJS.ProcessEnv {
  const pandoraHome = definition.envOverrides.PANDORA_HOME || defaultPandoraHome();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PANDORA_HOME: pandoraHome,
    ...definition.envOverrides,
    PANDORA_RUNTIME_ID: runtimeId,
    PANDORA_SLOT_ID: slotId,
    TERM: "xterm-256color",
  };
  env.PATH = [`${env.PANDORA_HOME}/bin`, env.PATH].filter(Boolean).join(":");
  return env;
}

function decodeAgentPayload(payloadBase64: string | null | undefined) {
  if (!payloadBase64) return null;
  try {
    return Buffer.from(payloadBase64, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function parseAgentPayload(signal: AgentCliSignal) {
  const decoded = decodeAgentPayload(signal.payloadBase64);
  if (!decoded) return null;
  try {
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readEventName(payload: Record<string, unknown> | null) {
  return (
    readString(payload?.hook_event_name) ??
    readString(payload?.eventType) ??
    readString(payload?.event_type) ??
    readString(payload?.type)
  );
}

function isWorkingEvent(eventName: string | null) {
  return (
    eventName === "Start" ||
    eventName === "UserPromptSubmit" ||
    eventName === "PostToolUse" ||
    eventName === "PostToolUseFailure" ||
    eventName === "BeforeAgent" ||
    eventName === "AfterTool" ||
    eventName === "sessionStart" ||
    eventName === "session_start" ||
    eventName === "userPromptSubmitted" ||
    eventName === "user_prompt_submit" ||
    eventName === "postToolUse" ||
    eventName === "post_tool_use" ||
    eventName === "task_started" ||
    eventName === "exec_command_begin" ||
    eventName === "PreToolUse"
  );
}

function isFinishedEvent(eventName: string | null) {
  return (
    eventName === "Stop" ||
    eventName === "SessionEnd" ||
    eventName === "sessionEnd" ||
    eventName === "session_end" ||
    eventName === "stop" ||
    eventName === "task_complete" ||
    eventName === "agent-turn-complete"
  );
}

function isApprovalEvent(eventName: string | null) {
  return (
    eventName === "PermissionRequest" ||
    eventName === "exec_approval_request" ||
    eventName === "apply_patch_approval_request" ||
    eventName === "request_user_input"
  );
}

function nextAgentActivity(signal: AgentCliSignal): AgentActivityState | null {
  const payload = parseAgentPayload(signal);
  const now = new Date().toISOString();
  const eventName = readEventName(payload);

  if (signal.source === "codex") {
    if (isApprovalEvent(eventName)) {
      return {
        vendor: "codex",
        phase: "waiting_approval",
        agentSessionID: null,
        updatedAt: now,
        message: readString(payload?.message),
        title: readString(payload?.title),
        toolName: null,
      };
    }
    if (isWorkingEvent(eventName)) {
      return {
        vendor: "codex",
        phase: "working",
        agentSessionID: null,
        updatedAt: now,
        message: readString(payload?.message),
        title: readString(payload?.title),
        toolName: null,
      };
    }
    if (isFinishedEvent(eventName) || !eventName) {
      return {
        vendor: "codex",
        phase: "finished",
        agentSessionID: null,
        updatedAt: now,
        message: readString(payload?.message),
        title: readString(payload?.title),
        toolName: null,
      };
    }
    return null;
  }

  if (signal.source !== "claude-code") {
    const phase = isApprovalEvent(eventName)
      ? "waiting_approval"
      : isWorkingEvent(eventName)
        ? "working"
        : isFinishedEvent(eventName) || !eventName
          ? "finished"
          : null;
    if (!phase) return null;
    return {
      vendor: signal.source,
      phase,
      agentSessionID: readString(payload?.session_id),
      updatedAt: now,
      message: readString(payload?.message),
      title: readString(payload?.title),
      toolName: readString(payload?.tool_name),
    };
  }

  const notificationType = readString(payload?.notification_type);
  const phase =
    eventName === "SessionStart"
      ? "idle"
      : eventName === "Notification" && notificationType === "permission_prompt"
        ? "waiting_approval"
        : eventName === "Notification" && notificationType === "idle_prompt"
          ? "waiting_input"
          : eventName === "PermissionRequest" || isApprovalEvent(eventName)
            ? "waiting_approval"
            : isWorkingEvent(eventName)
              ? "working"
              : isFinishedEvent(eventName)
                ? "finished"
                : null;

  if (!phase) return null;

  return {
    vendor: "claude-code",
    phase,
    agentSessionID: readString(payload?.session_id),
    updatedAt: now,
    message: readString(payload?.message),
    title: readString(payload?.title),
    toolName: readString(payload?.tool_name),
  };
}

function getForegroundProcess(shellPid: number): string | null {
  try {
    const tpgidResult = Bun.spawnSync(["ps", "-o", "tpgid=", "-p", String(shellPid)]);
    const tpgid = parseInt(tpgidResult.stdout.toString().trim(), 10);
    if (!tpgid || tpgid < 0 || tpgid === shellPid) {
      return null;
    }
    const argsResult = Bun.spawnSync(["ps", "-o", "args=", "-p", String(tpgid)]);
    const args = argsResult.stdout.toString().trim();
    if (!args) {
      return null;
    }
    return args;
  } catch {
    return null;
  }
}

function capabilitiesForStatus(
  status: SessionStatus,
  definition: SessionDefinition,
): ActionCapabilities {
  return {
    canFocus: status === "running" || status === "paused",
    canPause: definition.pauseSupported && status === "running",
    canResume: definition.resumeSupported && status === "paused",
    canClear: true,
    canStop: status === "running" || status === "paused" || status === "restarting",
    canRestart:
      status === "running" || status === "paused" || status === "crashed" || status === "stopped",
  };
}

export function aggregateSlotStatus(states: SessionState[]): AggregateStatus {
  if (states.some((state) => state.status === "crashed")) {
    return "crashed";
  }
  if (states.some((state) => state.status === "restarting")) {
    return "restarting";
  }
  if (states.some((state) => state.status === "running" || state.status === "paused")) {
    return "running";
  }
  return "stopped";
}

export class ProcessManager {
  private readonly sessionDefinitions = new Map<string, SessionDefinition>();
  private readonly slotDefinitions = new Map<string, SlotDefinition>();
  private readonly sessions = new Map<string, ManagedSession>();

  private readonly defaultCwd: string;

  constructor(
    slotDefinitions: SlotDefinition[],
    sessionDefinitions: SessionDefinition[],
    private readonly onSessionStateChanged: (session: SessionState) => void,
    private readonly onOutput: (sessionID: string, data: Buffer) => void,
    defaultCwd?: string,
    private readonly runtimeId: string = "legacy",
  ) {
    this.defaultCwd = defaultCwd ?? process.cwd();
    for (const slot of slotDefinitions) {
      this.slotDefinitions.set(slot.id, slot);
    }
    for (const definition of sessionDefinitions) {
      this.sessionDefinitions.set(definition.id, definition);
    }
  }

  listSessionStates(): SessionState[] {
    return Array.from(this.sessions.values()).map((session) => this.sessionState(session));
  }

  listSlotStates(): SlotState[] {
    return Array.from(this.slotDefinitions.values()).map((slot) => this.slotState(slot));
  }

  registerSlot(slot: SlotDefinition): void {
    this.slotDefinitions.set(slot.id, slot);
  }

  updateSlotDefinition(slot: Partial<SlotDefinition> & { id: string }): void {
    const existing = this.slotDefinitions.get(slot.id);
    if (!existing) {
      return;
    }
    this.slotDefinitions.set(slot.id, {
      ...existing,
      ...slot,
      sessionDefIDs: existing.sessionDefIDs,
    });
  }

  registerSessionDefinition(definition: SessionDefinition): void {
    this.sessionDefinitions.set(definition.id, definition);
  }

  updateSessionDefinition(definition: Partial<SessionDefinition> & { id: string }): void {
    const existing = this.sessionDefinitions.get(definition.id);
    if (!existing) {
      return;
    }
    const next = {
      ...existing,
      ...definition,
    };
    this.sessionDefinitions.set(definition.id, next);
    for (const session of this.findSessionsBySessionDefID(definition.id)) {
      session.definition = next;
      this.onSessionStateChanged(this.sessionState(session));
    }
  }

  removeSlot(slotID: string): void {
    const sessions = this.findSessionsBySlot(slotID);
    for (const session of sessions) {
      this.closeSession(session.instance.id);
    }
    this.slotDefinitions.delete(slotID);
  }

  removeSessionDefinition(sessionDefID: string): void {
    const existing = this.findSessionsBySessionDefID(sessionDefID);
    for (const session of existing) {
      this.closeSession(session.instance.id);
    }
    this.sessionDefinitions.delete(sessionDefID);
  }

  async autostartSlots(): Promise<void> {
    for (const slot of this.slotDefinitions.values()) {
      if (slot.autostart) {
        this.startSlot(slot.id);
      }
    }
  }

  closeAllSessions(): void {
    for (const session of this.sessions.values()) {
      this.stopForegroundPolling(session);
      if (session.stopTimer) {
        clearTimeout(session.stopTimer);
        session.stopTimer = null;
      }
      session.process?.kill("SIGKILL");
      session.process?.terminal?.close();
      session.process = null;
      session.instance.status = "stopped";
      session.instance.pid = null;
      session.instance.exitCode = null;
      session.instance.foregroundProcess = null;
    }
    this.sessions.clear();
  }

  startSlot(slotID: string): void {
    const definitions = this.sessionDefinitionsForSlot(slotID);
    for (const definition of definitions) {
      try {
        this.openSessionInstance(definition.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[process-manager] failed to start session ${definition.id} (${definition.name}) for slot ${slotID}: ${message}`,
        );
      }
    }
  }

  stopSlot(slotID: string): void {
    for (const session of this.findSessionsBySlot(slotID)) {
      this.stopSession(session.instance.id);
    }
  }

  restartSlot(slotID: string): void {
    for (const session of this.findSessionsBySlot(slotID)) {
      this.restartSession(session.instance.id);
    }
  }

  pauseSlot(slotID: string): void {
    for (const session of this.findSessionsBySlot(slotID)) {
      this.pauseSession(session.instance.id);
    }
  }

  resumeSlot(slotID: string): void {
    for (const session of this.findSessionsBySlot(slotID)) {
      this.resumeSession(session.instance.id);
    }
  }

  startSession(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session || session.process) {
      return;
    }
    this.spawnSession(session);
  }

  stopSession(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session?.process) {
      return;
    }

    session.instance.status = "stopped";
    session.instance.foregroundProcess = null;
    this.onSessionStateChanged(this.sessionState(session));
    session.process.kill("SIGTERM");
    session.stopTimer = setTimeout(() => {
      session.process?.kill("SIGKILL");
    }, 5_000);
  }

  restartSession(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session) {
      return;
    }

    session.instance.status = "restarting";
    this.onSessionStateChanged(this.sessionState(session));
    this.onOutput(session.instance.id, Buffer.from("\u001bc", "utf8"));
    if (session.process) {
      session.process.kill("SIGTERM");
      session.stopTimer = setTimeout(() => {
        session.process?.kill("SIGKILL");
        this.spawnSession(session);
      }, 500);
    } else {
      this.spawnSession(session);
    }
  }

  pauseSession(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session?.process || !session.definition.pauseSupported) {
      return;
    }
    session.process.kill("SIGSTOP");
    session.instance.status = "paused";
    session.instance.foregroundProcess = null;
    this.onSessionStateChanged(this.sessionState(session));
  }

  resumeSession(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session?.process || !session.definition.resumeSupported) {
      return;
    }
    session.process.kill("SIGCONT");
    session.instance.status = "running";
    this.onSessionStateChanged(this.sessionState(session));
  }

  openSessionInstance(sessionDefID: string): SessionState | null {
    const definition = this.sessionDefinitions.get(sessionDefID);
    if (!definition) {
      return null;
    }

    const managed: ManagedSession = {
      definition,
      instance: {
        id: randomUUID(),
        sessionDefID: definition.id,
        slotID: definition.slotID,
        status: "stopped",
        pid: null,
        exitCode: null,
        startedAt: null,
        lastOutputAt: null,
        foregroundProcess: null,
        agentActivity: null,
      },
      process: null,
      stopTimer: null,
      fgPollTimer: null,
    };

    this.sessions.set(managed.instance.id, managed);
    this.spawnSession(managed);
    return this.sessionState(managed);
  }

  closeSession(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session) {
      return;
    }
    this.stopForegroundPolling(session);
    if (session.stopTimer) {
      clearTimeout(session.stopTimer);
    }
    session.process?.kill("SIGKILL");
    session.process?.terminal?.close();
    this.sessions.delete(sessionID);
  }

  writeToSession(sessionID: string, data: Buffer): void {
    const session = this.sessions.get(sessionID);
    if (session?.process) {
      logger.debug(
        {
          tag: "PTY_WRITE",
          sessionID,
          pid: session.instance.pid,
          cmd: session.definition.command,
          bytes: data.length,
        },
        "pty write",
      );
      session.process.terminal?.write(data);
    }
  }

  resizeSession(sessionID: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionID);
    if (session) {
      logger.debug(
        {
          tag: "PTY_RESIZE",
          sessionID,
          pid: session.instance.pid,
          cmd: session.definition.command,
          cols,
          rows,
        },
        "pty resize",
      );
    }
    session?.process?.terminal?.resize(Math.max(cols, 1), Math.max(rows, 1));
  }

  recordAgentCliSignal(signal: AgentCliSignal): SessionState | null {
    const session = this.findSessionsBySlot(signal.slotID).find(
      (candidate) => candidate.instance.status === "running" || candidate.instance.status === "paused",
    );
    if (!session) {
      return null;
    }

    const activity = nextAgentActivity(signal);
    if (!activity) {
      return null;
    }

    session.instance.agentActivity = activity;
    const state = this.sessionState(session);
    this.onSessionStateChanged(state);
    return state;
  }

  private spawnSession(session: ManagedSession): void {
    if (session.process) {
      return;
    }

    const shell = process.env.SHELL || "/bin/zsh";
    const env = sessionSpawnEnv(session.definition, this.runtimeId, session.instance.slotID);

    const sid = session.instance.id;
    const cmd = session.definition.command;
    const normalizedCwd = session.definition.cwd?.trim();
    const cwd = normalizedCwd && normalizedCwd.length > 0 ? normalizedCwd : this.defaultCwd;

    logger.info({ tag: "SPAWN", sessionID: sid, cmd, cwd, shell }, "spawning session");

    let outputCount = 0;
    let outputBytes = 0;
    let lastLogTime = Date.now();
    const subprocess = Bun.spawn([shell, "-lc", cmd], {
      cwd,
      env,
      terminal: {
        cols: 120,
        rows: 40,
        name: "xterm-256color",
        data: (_terminal, data) => {
          const buf = Buffer.from(data);
          outputCount++;
          outputBytes += buf.length;
          session.instance.lastOutputAt = new Date().toISOString();
          const now = Date.now();
          if (
            outputCount <= 5 ||
            outputCount % 50 === 0 ||
            buf.length > 4096 ||
            now - lastLogTime > 500
          ) {
            logger.debug(
              {
                tag: "PTY_OUT",
                sessionID: sid,
                cmd,
                chunk: outputCount,
                bytes: buf.length,
                totalBytes: outputBytes,
              },
              "pty output",
            );
            lastLogTime = now;
          }
          this.onOutput(sid, buf);
        },
      },
    });

    session.process = subprocess;
    session.instance.pid = subprocess.pid;
    session.instance.status = "running";
    session.instance.startedAt = new Date().toISOString();
    session.instance.exitCode = null;
    session.instance.foregroundProcess = null;
    session.instance.agentActivity = null;

    logger.info({ tag: "SPAWN", sessionID: sid, pid: subprocess.pid, cmd }, "session running");
    this.onSessionStateChanged(this.sessionState(session));

    this.startForegroundPolling(session);

    void subprocess.exited.then((exitCode) => {
      logger.info(
        {
          tag: "EXIT",
          sessionID: sid,
          pid: session.instance.pid,
          exitCode,
          outputChunks: outputCount,
          outputBytes,
        },
        "session exited",
      );
      this.stopForegroundPolling(session);
      session.process?.terminal?.close();
      session.process = null;
      session.instance.pid = null;
      session.instance.exitCode = exitCode;
      session.instance.foregroundProcess = null;
      session.instance.agentActivity = null;
      if (session.stopTimer) {
        clearTimeout(session.stopTimer);
        session.stopTimer = null;
      }

      if (session.instance.status === "restarting") {
        logger.info({ tag: "EXIT", sessionID: sid }, "restarting session");
        this.spawnSession(session);
        return;
      }

      session.instance.status = session.instance.status === "stopped" ? "stopped" : "crashed";
      logger.info(
        { tag: "EXIT", sessionID: sid, status: session.instance.status },
        "session final status",
      );
      this.onSessionStateChanged(this.sessionState(session));
    });
  }

  private startForegroundPolling(session: ManagedSession): void {
    this.stopForegroundPolling(session);

    const updateForegroundProcess = () => {
      if (
        !session.process ||
        session.instance.pid == null ||
        session.instance.status !== "running"
      ) {
        return;
      }

      const foregroundProcess = getForegroundProcess(session.instance.pid);
      if (session.instance.foregroundProcess === foregroundProcess) {
        return;
      }

      session.instance.foregroundProcess = foregroundProcess;
      this.onSessionStateChanged(this.sessionState(session));
    };

    updateForegroundProcess();
    session.fgPollTimer = setInterval(updateForegroundProcess, FG_POLL_INTERVAL_MS);
  }

  private stopForegroundPolling(session: ManagedSession): void {
    if (session.fgPollTimer) {
      clearInterval(session.fgPollTimer);
      session.fgPollTimer = null;
    }
  }

  private sessionDefinitionsForSlot(slotID: string): SessionDefinition[] {
    return Array.from(this.sessionDefinitions.values()).filter(
      (definition) => definition.slotID === slotID,
    );
  }

  private findSessionsBySlot(slotID: string): ManagedSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.instance.slotID === slotID,
    );
  }

  private findSessionsBySessionDefID(sessionDefID: string): ManagedSession[] {
    return Array.from(this.sessions.values()).filter(
      (session) => session.instance.sessionDefID === sessionDefID,
    );
  }

  private slotState(slot: SlotDefinition): SlotState {
    const sessions = this.findSessionsBySlot(slot.id).map((session) => this.sessionState(session));
    return {
      ...slot,
      aggregateStatus: aggregateSlotStatus(sessions),
      sessionIDs: sessions.map((session) => session.id),
      capabilities: {
        canFocus: sessions.some((session) => session.capabilities.canFocus),
        canPause: sessions.some((session) => session.capabilities.canPause),
        canResume: sessions.some((session) => session.capabilities.canResume),
        canClear: sessions.some((session) => session.capabilities.canClear),
        canStop: sessions.some((session) => session.capabilities.canStop),
        canRestart: sessions.some((session) => session.capabilities.canRestart),
      },
    };
  }

  private sessionState(session: ManagedSession): SessionState {
    return {
      ...session.instance,
      kind: session.definition.kind,
      name: session.definition.name,
      port: session.definition.port,
      capabilities: capabilitiesForStatus(session.instance.status, session.definition),
    };
  }
}
