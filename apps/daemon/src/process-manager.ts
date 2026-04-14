import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "./logger";
import { PortManager } from "./port-manager";
import type {
  ActionCapabilities,
  AggregateStatus,
  AgentActivityState,
  AgentCliSignal,
  DetectedPort,
  SessionDefinition,
  SessionInstance,
  SessionState,
  SessionStatus,
  SlotDefinition,
  SlotState,
} from "./types";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const workerEntry = path.join(moduleDir, "pty-worker.js");

interface ManagedSession {
  definition: SessionDefinition;
  instance: SessionInstance;
  worker: ChildProcess | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
  outputPaused: boolean;
  crashCount: number;
  exitHandled: boolean;
}

type WorkerSpawnMessage = {
  type: "spawn";
  shell: string;
  cmd: string;
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
};

type WorkerControlMessage =
  | WorkerSpawnMessage
  | { type: "write"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "kill"; signal?: NodeJS.Signals };

type WorkerRuntimeMessage =
  | { type: "spawned"; pid: number | null }
  | { type: "output"; data: Buffer | Uint8Array }
  | { type: "foregroundProcess"; name: string }
  | { type: "exited"; exitCode: number | null; signal: number | string | null };

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
  private readonly portManager: PortManager;
  private outputsPaused = false;

  constructor(
    slotDefinitions: SlotDefinition[],
    sessionDefinitions: SessionDefinition[],
    private readonly onSessionStateChanged: (session: SessionState) => void,
    private readonly onOutput: (sessionID: string, data: Buffer) => void,
    private readonly onPortsChanged: (ports: DetectedPort[]) => void,
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
    this.portManager = new PortManager();
    this.portManager.onPortsChanged((ports) => this.onPortsChanged(ports));
    this.portManager.start();
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

  listDetectedPorts(): import("./types").DetectedPort[] {
    return this.portManager.listPorts();
  }

  closeAllSessions(): void {
    this.portManager.stop();
    for (const session of this.sessions.values()) {
      this.clearStopTimer(session);
      this.detachWorker(session);
      session.instance.status = "stopped";
      session.instance.pid = null;
      session.instance.exitCode = null;
      session.instance.foregroundProcess = null;
      session.instance.ptyForegroundProcess = null;
    }
    this.sessions.clear();
  }

  setOutputsPaused(paused: boolean): void {
    if (this.outputsPaused === paused) {
      return;
    }
    this.outputsPaused = paused;
    for (const session of this.sessions.values()) {
      if (paused) {
        this.pauseSessionOutput(session.instance.id);
      } else {
        this.resumeSessionOutput(session.instance.id);
      }
    }
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
    if (!session || session.worker) {
      return;
    }
    this.spawnSession(session);
  }

  stopSession(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session?.worker) {
      return;
    }

    session.instance.status = "stopped";
    session.instance.foregroundProcess = null;
    session.instance.ptyForegroundProcess = null;
    this.onSessionStateChanged(this.sessionState(session));
    this.sendToWorker(session, { type: "kill", signal: "SIGTERM" });
    this.clearStopTimer(session);
    session.stopTimer = setTimeout(() => {
      this.sendToWorker(session, { type: "kill", signal: "SIGKILL" });
    }, 5_000);
  }

  restartSession(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session) {
      return;
    }

    session.instance.status = "restarting";
    session.instance.foregroundProcess = null;
    session.instance.ptyForegroundProcess = null;
    session.instance.agentActivity = null;
    this.onSessionStateChanged(this.sessionState(session));
    this.onOutput(session.instance.id, Buffer.from("\u001bc", "utf8"));

    if (session.worker) {
      this.sendToWorker(session, { type: "kill", signal: "SIGTERM" });
      this.clearStopTimer(session);
      session.stopTimer = setTimeout(() => {
        this.sendToWorker(session, { type: "kill", signal: "SIGKILL" });
      }, 500);
    } else {
      this.spawnSession(session);
    }
  }

  pauseSession(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session?.worker || !session.definition.pauseSupported) {
      return;
    }
    this.sendToWorker(session, { type: "kill", signal: "SIGSTOP" });
    session.instance.status = "paused";
    session.instance.foregroundProcess = null;
    session.instance.ptyForegroundProcess = null;
    this.onSessionStateChanged(this.sessionState(session));
  }

  resumeSession(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session?.worker || !session.definition.resumeSupported) {
      return;
    }
    this.sendToWorker(session, { type: "kill", signal: "SIGCONT" });
    session.instance.status = "running";
    this.onSessionStateChanged(this.sessionState(session));
  }

  pauseSessionOutput(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session?.worker || session.outputPaused) {
      return;
    }
    session.outputPaused = true;
    this.sendToWorker(session, { type: "pause" });
  }

  resumeSessionOutput(sessionID: string): void {
    const session = this.sessions.get(sessionID);
    if (!session?.worker || !session.outputPaused) {
      return;
    }
    session.outputPaused = false;
    this.sendToWorker(session, { type: "resume" });
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
        ptyForegroundProcess: null,
        agentActivity: null,
      },
      worker: null,
      stopTimer: null,
      outputPaused: false,
      crashCount: 0,
      exitHandled: false,
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
    this.clearStopTimer(session);
    this.detachWorker(session);
    this.sessions.delete(sessionID);
  }

  writeToSession(sessionID: string, data: Buffer): void {
    const session = this.sessions.get(sessionID);
    if (!session?.worker) {
      return;
    }
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
    this.sendToWorker(session, { type: "write", data: data.toString("utf8") });
  }

  resizeSession(sessionID: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionID);
    if (!session?.worker) {
      return;
    }
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
    this.sendToWorker(session, { type: "resize", cols, rows });
  }

  recordAgentCliSignal(signal: AgentCliSignal): SessionState | null {
    const session = this.findSessionsBySlot(signal.slotID).find(
      (candidate) =>
        candidate.instance.status === "running" || candidate.instance.status === "paused",
    );
    if (!session) {
      return null;
    }

    const activity = nextAgentActivity(signal);
    if (!activity) {
      return null;
    }

    session.instance.agentActivity = activity;
    if (activity.phase !== "finished" && activity.phase !== "idle") {
      session.instance.foregroundProcess = signal.source;
    } else {
      session.instance.foregroundProcess = null;
    }
    const state = this.sessionState(session);
    this.onSessionStateChanged(state);
    return state;
  }

  private spawnSession(session: ManagedSession): void {
    if (session.worker) {
      return;
    }

    const shell = process.env.SHELL || "/bin/zsh";
    const env = sessionSpawnEnv(session.definition, this.runtimeId, session.instance.slotID);
    const sid = session.instance.id;
    const cmd = session.definition.command;
    const normalizedCwd = session.definition.cwd?.trim();
    const cwd = normalizedCwd && normalizedCwd.length > 0 ? normalizedCwd : this.defaultCwd;

    logger.info({ tag: "SPAWN", sessionID: sid, cmd, cwd, shell }, "spawning session");

    const worker = fork(workerEntry, [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      serialization: "advanced",
    });

    session.worker = worker;
    session.exitHandled = false;
    session.outputPaused = this.outputsPaused;
    session.instance.status = "running";
    session.instance.startedAt = new Date().toISOString();
    session.instance.exitCode = null;
    session.instance.pid = null;
    session.instance.foregroundProcess = null;
    session.instance.ptyForegroundProcess = null;
    session.instance.agentActivity = null;
    this.onSessionStateChanged(this.sessionState(session));

    worker.on("message", (message: WorkerRuntimeMessage) => {
      this.handleWorkerMessage(session, message);
    });
    worker.once("exit", (code, signal) => {
      this.handleWorkerExit(session, code, signal ?? null);
    });
    worker.once("error", (error) => {
      logger.error({ tag: "SPAWN", sessionID: sid, err: error.message }, "worker error");
    });

    const spawnMessage: WorkerSpawnMessage = {
      type: "spawn",
      shell,
      cmd,
      cwd,
      env: env as Record<string, string>,
      cols: 120,
      rows: 40,
    };
    this.sendToWorker(session, spawnMessage);
    if (session.outputPaused) {
      this.sendToWorker(session, { type: "pause" });
    }
  }

  private handleWorkerMessage(session: ManagedSession, message: WorkerRuntimeMessage): void {
    switch (message.type) {
      case "spawned":
        session.instance.pid = message.pid ?? null;
        session.crashCount = 0;
        if (message.pid) {
          this.portManager.registerSession(session.instance.id, message.pid);
        }
        this.onSessionStateChanged(this.sessionState(session));
        break;
      case "output": {
        const chunk = Buffer.isBuffer(message.data)
          ? message.data
          : Buffer.from(message.data);
        session.instance.lastOutputAt = new Date().toISOString();
        this.portManager.checkOutputForHint(chunk, session.instance.id);
        this.onOutput(session.instance.id, chunk);
        break;
      }
      case "foregroundProcess": {
        const name = message.name || null;
        if (session.instance.ptyForegroundProcess !== name) {
          session.instance.ptyForegroundProcess = name;
          this.onSessionStateChanged(this.sessionState(session));
        }
        break;
      }
      case "exited":
        this.finalizeWorkerExit(session, message.exitCode, message.signal);
        break;
    }
  }

  private handleWorkerExit(
    session: ManagedSession,
    exitCode: number | null,
    signal: number | string | null,
  ): void {
    this.finalizeWorkerExit(session, exitCode, signal);
  }

  private finalizeWorkerExit(
    session: ManagedSession,
    exitCode: number | null,
    signal: number | string | null,
  ): void {
    if (session.exitHandled) {
      return;
    }
    session.exitHandled = true;

    this.clearStopTimer(session);
    this.portManager.unregisterSession(session.instance.id);
    const worker = session.worker;
    if (worker) {
      worker.removeAllListeners();
    }
    session.worker = null;
    session.outputPaused = false;
    session.instance.pid = null;
    session.instance.exitCode = exitCode;
    session.instance.foregroundProcess = null;
    session.instance.ptyForegroundProcess = null;
    session.instance.agentActivity = null;

    logger.info(
      {
        tag: "EXIT",
        sessionID: session.instance.id,
        exitCode,
        signal,
        status: session.instance.status,
      },
      "worker exited",
    );

    if (session.instance.status === "restarting") {
      this.spawnSession(session);
      return;
    }

    session.instance.status = session.instance.status === "stopped" ? "stopped" : "crashed";
    this.onSessionStateChanged(this.sessionState(session));

    if (session.definition.restartPolicy === "always" && session.instance.status === "crashed") {
      const backoff = Math.min(30_000, 1_000 * 2 ** session.crashCount);
      session.crashCount += 1;
      setTimeout(() => {
        if (session.instance.status !== "crashed" || session.worker) {
          return;
        }
        session.instance.status = "restarting";
        this.onSessionStateChanged(this.sessionState(session));
        this.spawnSession(session);
      }, backoff);
    }
  }

  private detachWorker(session: ManagedSession): void {
    const worker = session.worker;
    if (!worker) {
      return;
    }
    session.exitHandled = true;
    session.worker = null;
    worker.removeAllListeners();
    worker.kill("SIGKILL");
    session.outputPaused = false;
  }

  private sendToWorker(session: ManagedSession, message: WorkerControlMessage): void {
    session.worker?.send(message);
  }

  private clearStopTimer(session: ManagedSession): void {
    if (!session.stopTimer) {
      return;
    }
    clearTimeout(session.stopTimer);
    session.stopTimer = null;
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
