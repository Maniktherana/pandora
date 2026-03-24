import { randomUUID } from "node:crypto";

import type {
  ActionCapabilities,
  AggregateStatus,
  SessionDefinition,
  SessionInstance,
  SessionState,
  SessionStatus,
  SlotDefinition,
  SlotState
} from "./types";

interface ManagedSession {
  definition: SessionDefinition;
  instance: SessionInstance;
  process: Bun.Subprocess | null;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

function capabilitiesForStatus(status: SessionStatus, definition: SessionDefinition): ActionCapabilities {
  return {
    canFocus: status === "running" || status === "paused",
    canPause: definition.pauseSupported && status === "running",
    canResume: definition.resumeSupported && status === "paused",
    canClear: true,
    canStop: status === "running" || status === "paused" || status === "restarting",
    canRestart: status === "running" || status === "paused" || status === "crashed" || status === "stopped"
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

  constructor(
    slotDefinitions: SlotDefinition[],
    sessionDefinitions: SessionDefinition[],
    private readonly onSessionStateChanged: (session: SessionState) => void,
    private readonly onOutput: (sessionID: string, data: Buffer) => void
  ) {
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

  registerSessionDefinition(definition: SessionDefinition): void {
    this.sessionDefinitions.set(definition.id, definition);
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

  startSlot(slotID: string): void {
    const definitions = this.sessionDefinitionsForSlot(slotID);
    for (const definition of definitions) {
      this.openSessionInstance(definition.id);
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
        lastOutputAt: null
      },
      process: null,
      stopTimer: null
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
    if (session.stopTimer) {
      clearTimeout(session.stopTimer);
    }
    session.process?.kill("SIGKILL");
    session.process?.terminal?.close();
    this.sessions.delete(sessionID);
  }

  writeToSession(sessionID: string, data: Buffer): void {
    const session = this.sessions.get(sessionID);
    session?.process?.terminal?.write(data);
  }

  resizeSession(sessionID: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionID);
    session?.process?.terminal?.resize(Math.max(cols, 1), Math.max(rows, 1));
  }

  private spawnSession(session: ManagedSession): void {
    if (session.process) {
      return;
    }

    const shell = process.env.SHELL || "/bin/zsh";
    const env = {
      ...process.env,
      ...session.definition.envOverrides,
      TERM: "xterm-256color"
    };

    const subprocess = Bun.spawn([shell, "-lc", session.definition.command], {
      cwd: session.definition.cwd ?? process.cwd(),
      env,
      terminal: {
        cols: 120,
        rows: 40,
        name: "xterm-256color",
        data: (_terminal, data) => {
          session.instance.lastOutputAt = new Date().toISOString();
          this.onOutput(session.instance.id, Buffer.from(data));
        },
      },
    });

    session.process = subprocess;
    session.instance.pid = subprocess.pid;
    session.instance.status = "running";
    session.instance.startedAt = new Date().toISOString();
    session.instance.exitCode = null;
    this.onSessionStateChanged(this.sessionState(session));

    void subprocess.exited.then((exitCode) => {
      session.process?.terminal?.close();
      session.process = null;
      session.instance.pid = null;
      session.instance.exitCode = exitCode;
      if (session.stopTimer) {
        clearTimeout(session.stopTimer);
        session.stopTimer = null;
      }

      if (session.instance.status === "restarting") {
        this.spawnSession(session);
        return;
      }

      session.instance.status = session.instance.status === "stopped" ? "stopped" : "crashed";
      this.onSessionStateChanged(this.sessionState(session));
    });
  }

  private sessionDefinitionsForSlot(slotID: string): SessionDefinition[] {
    return Array.from(this.sessionDefinitions.values()).filter((definition) => definition.slotID === slotID);
  }

  private findSessionsBySlot(slotID: string): ManagedSession[] {
    return Array.from(this.sessions.values()).filter((session) => session.instance.slotID === slotID);
  }

  private findSessionsBySessionDefID(sessionDefID: string): ManagedSession[] {
    return Array.from(this.sessions.values()).filter((session) => session.instance.sessionDefID === sessionDefID);
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
        canRestart: sessions.some((session) => session.capabilities.canRestart)
      }
    };
  }

  private sessionState(session: ManagedSession): SessionState {
    return {
      ...session.instance,
      kind: session.definition.kind,
      name: session.definition.name,
      port: session.definition.port,
      capabilities: capabilitiesForStatus(session.instance.status, session.definition)
    };
  }
}
