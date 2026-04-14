import { createHash } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import net from "node:net";
import path from "node:path";

import {
  createSessionDefinition,
  createSlotDefinition,
  listSessionDefinitions,
  listSlotDefinitions,
  openDatabase,
  removeSessionDefinition,
  removeSlotDefinition,
  updateSessionDefinition,
  updateSlotDefinition,
} from "./db";
import { logger } from "./logger";
import { ProcessManager } from "./process-manager";
import {
  createControlMessageReader,
  writeControlMessage,
  writeOutputFrame,
} from "./protocol";
import type { ClientMessage, DaemonMessage, SlotState } from "./types";

interface DataClientState {
  socket: net.Socket;
  draining: boolean;
}

export class DaemonServer {
  private readonly db;
  private readonly controlClients = new Set<net.Socket>();
  private readonly dataClients = new Map<net.Socket, DataClientState>();
  private readonly processManager: ProcessManager;
  private readonly controlSocketPath: string;
  private readonly dataSocketPath: string;
  private allClientsDraining = false;
  private controlServer: net.Server | null = null;
  private dataServer: net.Server | null = null;

  constructor(workspacePath: string, defaultCwd?: string, runtimeId?: string) {
    const normalizedPath = path.resolve(workspacePath);
    const rid = runtimeId ?? "legacy";
    const hash = createHash("sha256").update(`${normalizedPath}\0${rid}`).digest("hex").slice(0, 8);
    this.controlSocketPath = `/tmp/pandora-${hash}-ctl.sock`;
    this.dataSocketPath = `/tmp/pandora-${hash}-data.sock`;
    this.db = openDatabase({
      workspacePath: normalizedPath,
      defaultCwd: defaultCwd ?? normalizedPath,
      runtimeId: rid,
    });

    const slotDefinitions = listSlotDefinitions(this.db);
    const sessionDefinitions = listSessionDefinitions(this.db);
    let broadcastOutputCount = 0;
    let broadcastOutputBytes = 0;
    const resolvedDefaultCwd = defaultCwd ?? normalizedPath;
    this.processManager = new ProcessManager(
      slotDefinitions,
      sessionDefinitions,
      (session) => this.broadcastControl({ type: "session_state_changed", session }),
      (sessionID, data) => {
        if (this.dataClients.size === 0 || this.allClientsDraining) {
          return;
        }
        broadcastOutputCount++;
        broadcastOutputBytes += data.length;
        if (broadcastOutputCount % 100 === 0) {
          logger.debug(
            {
              tag: "BROADCAST",
              chunk: broadcastOutputCount,
              sessionID,
              bytes: data.length,
              totalBytes: broadcastOutputBytes,
              clients: this.dataClients.size,
            },
            "output_frame",
          );
        }
        this.broadcastOutput(sessionID, data);
      },
      (ports) => this.broadcastControl({ type: "ports_snapshot", ports }),
      resolvedDefaultCwd,
      rid,
    );
  }

  async start(): Promise<void> {
    if (existsSync(this.controlSocketPath)) {
      const alreadyListening = await new Promise<boolean>((resolve) => {
        const client = net.createConnection(this.controlSocketPath);
        const done = (value: boolean) => {
          client.removeAllListeners();
          client.destroy();
          resolve(value);
        };
        client.once("connect", () => done(true));
        client.once("error", () => done(false));
      });

      if (alreadyListening) {
        console.log(`pandorad already running on ${this.controlSocketPath}`);
        this.db.close();
        process.exit(0);
      }
    }
    if (existsSync(this.controlSocketPath)) {
      unlinkSync(this.controlSocketPath);
    }
    if (existsSync(this.dataSocketPath)) {
      unlinkSync(this.dataSocketPath);
    }

    try {
      await this.processManager.autostartSlots();
    } catch (error) {
      this.processManager.closeAllSessions();
      throw error;
    }

    this.controlServer = net.createServer((socket) => this.handleControlConnection(socket));
    this.dataServer = net.createServer((socket) => this.handleDataConnection(socket));

    await new Promise<void>((resolve, reject) => {
      this.controlServer?.once("error", reject);
      this.controlServer?.listen(this.controlSocketPath, resolve);
    });
    await new Promise<void>((resolve, reject) => {
      this.dataServer?.once("error", reject);
      this.dataServer?.listen(this.dataSocketPath, resolve);
    });

    console.log(`pandorad listening on ${this.controlSocketPath} + ${this.dataSocketPath}`);
  }

  async stop(): Promise<void> {
    this.processManager.closeAllSessions();

    for (const socket of this.controlClients) {
      socket.destroy();
    }
    this.controlClients.clear();

    for (const { socket } of this.dataClients.values()) {
      socket.destroy();
    }
    this.dataClients.clear();
    this.updateAllClientsDraining();

    if (this.controlServer) {
      await new Promise<void>((resolve) => this.controlServer?.close(() => resolve()));
      this.controlServer = null;
    }
    if (this.dataServer) {
      await new Promise<void>((resolve) => this.dataServer?.close(() => resolve()));
      this.dataServer = null;
    }

    if (existsSync(this.controlSocketPath)) {
      unlinkSync(this.controlSocketPath);
    }
    if (existsSync(this.dataSocketPath)) {
      unlinkSync(this.dataSocketPath);
    }
    this.db.close();
  }

  getControlSocketPath(): string {
    return this.controlSocketPath;
  }

  getDataSocketPath(): string {
    return this.dataSocketPath;
  }

  private handleControlConnection(socket: net.Socket): void {
    this.controlClients.add(socket);
    logger.info({ tag: "CONN_CTL", total: this.controlClients.size }, "control client connected");
    this.writeControl(socket, { type: "slot_snapshot", slots: this.processManager.listSlotStates() });
    this.writeControl(socket, {
      type: "session_snapshot",
      sessions: this.processManager.listSessionStates(),
    });
    this.writeControl(socket, {
      type: "ports_snapshot",
      ports: this.processManager.listDetectedPorts(),
    });

    const reader = createControlMessageReader(
      (message) => {
        this.handleControlMessage(socket, message as ClientMessage);
      },
      (error) => {
        logger.warn({ tag: "CONN_CTL", err: error.message }, "message parse error");
        this.writeControl(socket, { type: "error", message: error.message });
      },
    );

    socket.on("data", reader);
    socket.on("close", () => {
      this.controlClients.delete(socket);
      logger.info(
        { tag: "CONN_CTL", total: this.controlClients.size },
        "control client disconnected",
      );
    });
    socket.on("error", (err) => {
      logger.error(
        { tag: "CONN_CTL", err: err.message, total: this.controlClients.size },
        "control client error",
      );
      this.controlClients.delete(socket);
    });
  }

  private handleDataConnection(socket: net.Socket): void {
    const state: DataClientState = { socket, draining: false };
    this.dataClients.set(socket, state);
    this.updateAllClientsDraining();
    logger.info({ tag: "CONN_DATA", total: this.dataClients.size }, "data client connected");

    socket.on("drain", () => {
      state.draining = false;
      this.updateAllClientsDraining();
    });
    socket.on("close", () => {
      this.dataClients.delete(socket);
      this.updateAllClientsDraining();
      logger.info(
        { tag: "CONN_DATA", total: this.dataClients.size },
        "data client disconnected",
      );
    });
    socket.on("error", (err) => {
      this.dataClients.delete(socket);
      this.updateAllClientsDraining();
      logger.error(
        { tag: "CONN_DATA", err: err.message, total: this.dataClients.size },
        "data client error",
      );
    });
  }

  private handleControlMessage(socket: net.Socket, message: ClientMessage): void {
    if (message.type !== "input" && message.type !== "resize") {
      logger.debug({ tag: "MSG", type: message.type }, "client message");
    }

    switch (message.type) {
      case "request_snapshot":
        this.writeControl(socket, {
          type: "slot_snapshot",
          slots: this.processManager.listSlotStates(),
        });
        this.writeControl(socket, {
          type: "session_snapshot",
          sessions: this.processManager.listSessionStates(),
        });
        break;
      case "create_slot": {
        const slot = createSlotDefinition(this.db, {
          id: message.slot.id,
          kind: message.slot.kind,
          name: message.slot.name,
          autostart: message.slot.autostart,
          presentationMode: message.slot.presentationMode,
          primarySessionDefID: message.slot.primarySessionDefID ?? null,
          persisted: message.slot.persisted,
          sortOrder: message.slot.sortOrder,
        });
        this.processManager.registerSlot(slot);
        this.broadcastControl({ type: "slot_added", slot: this.findSlotState(slot.id) });
        break;
      }
      case "update_slot":
        updateSlotDefinition(this.db, {
          id: message.slot.id,
          kind: message.slot.kind,
          name: message.slot.name,
          autostart: message.slot.autostart,
          presentationMode: message.slot.presentationMode,
          primarySessionDefID: message.slot.primarySessionDefID,
          persisted: message.slot.persisted,
          sortOrder: message.slot.sortOrder,
        });
        this.processManager.updateSlotDefinition(message.slot);
        this.broadcastControl({ type: "slot_state_changed", slot: this.findSlotState(message.slot.id) });
        break;
      case "remove_slot":
        this.processManager.removeSlot(message.slotID);
        removeSlotDefinition(this.db, message.slotID);
        this.broadcastControl({ type: "slot_removed", slotID: message.slotID });
        break;
      case "create_session_def": {
        const session = createSessionDefinition(this.db, {
          id: message.session.id,
          slotID: message.session.slotID,
          kind: message.session.kind,
          name: message.session.name,
          command: message.session.command,
          cwd: message.session.cwd,
          port: message.session.port,
          envOverrides: message.session.envOverrides,
          restartPolicy: message.session.restartPolicy,
          pauseSupported: message.session.pauseSupported,
          resumeSupported: message.session.resumeSupported,
        });
        this.processManager.registerSessionDefinition(session);
        this.broadcastSnapshots();
        break;
      }
      case "update_session_def":
        updateSessionDefinition(this.db, {
          id: message.session.id,
          slotID: message.session.slotID,
          kind: message.session.kind,
          name: message.session.name,
          command: message.session.command,
          cwd: message.session.cwd,
          port: message.session.port,
          envOverrides: message.session.envOverrides,
          restartPolicy: message.session.restartPolicy,
          pauseSupported: message.session.pauseSupported,
          resumeSupported: message.session.resumeSupported,
        });
        this.processManager.updateSessionDefinition(message.session);
        this.broadcastSnapshots();
        break;
      case "remove_session_def":
        this.processManager.removeSessionDefinition(message.sessionDefID);
        removeSessionDefinition(this.db, message.sessionDefID);
        this.broadcastSnapshots();
        break;
      case "start_slot":
        this.processManager.startSlot(message.slotID);
        this.broadcastSnapshots();
        break;
      case "stop_slot":
        this.processManager.stopSlot(message.slotID);
        this.broadcastSnapshots();
        break;
      case "restart_slot":
        this.processManager.restartSlot(message.slotID);
        this.broadcastSnapshots();
        break;
      case "pause_slot":
        this.processManager.pauseSlot(message.slotID);
        this.broadcastSnapshots();
        break;
      case "resume_slot":
        this.processManager.resumeSlot(message.slotID);
        this.broadcastSnapshots();
        break;
      case "start_session":
        this.processManager.startSession(message.sessionID);
        this.broadcastSnapshots();
        break;
      case "stop_session":
        this.processManager.stopSession(message.sessionID);
        this.broadcastSnapshots();
        break;
      case "restart_session":
        this.processManager.restartSession(message.sessionID);
        this.broadcastSnapshots();
        break;
      case "pause_session":
        this.processManager.pauseSession(message.sessionID);
        this.broadcastSnapshots();
        break;
      case "resume_session":
        this.processManager.resumeSession(message.sessionID);
        this.broadcastSnapshots();
        break;
      case "open_session_instance": {
        const session = this.processManager.openSessionInstance(message.sessionDefID);
        if (session) {
          this.broadcastControl({ type: "session_opened", session });
          this.broadcastSnapshots();
        }
        break;
      }
      case "close_session_instance":
        this.processManager.closeSession(message.sessionID);
        this.broadcastControl({ type: "session_closed", sessionID: message.sessionID });
        this.broadcastSnapshots();
        break;
      case "input":
        this.processManager.writeToSession(message.sessionID, Buffer.from(message.data, "base64"));
        break;
      case "resize":
        this.processManager.resizeSession(message.sessionID, message.cols, message.rows);
        break;
      case "agent_cli_signal":
        this.processManager.recordAgentCliSignal(message.signal);
        break;
      default:
        this.writeControl(socket, { type: "error", message: "Unsupported message" });
    }
  }

  private findSlotState(slotID: string): SlotState {
    const slot = this.processManager.listSlotStates().find((candidate) => candidate.id === slotID);
    if (!slot) {
      throw new Error(`Unknown slot: ${slotID}`);
    }
    return slot;
  }

  private broadcastSnapshots(): void {
    this.broadcastControl({ type: "slot_snapshot", slots: this.processManager.listSlotStates() });
    this.broadcastControl({ type: "session_snapshot", sessions: this.processManager.listSessionStates() });
  }

  private broadcastCount = 0;
  private broadcastControl(message: DaemonMessage): void {
    this.broadcastCount++;
    const t0 = Date.now();
    for (const socket of this.controlClients) {
      this.writeControl(socket, message);
    }
    const elapsed = Date.now() - t0;
    if (elapsed > 5) {
      logger.warn(
        {
          tag: "BROADCAST_CTL",
          type: message.type,
          count: this.broadcastCount,
          clients: this.controlClients.size,
          elapsedMs: elapsed,
        },
        "slow control broadcast",
      );
    }
  }

  private broadcastOutput(sessionID: string, data: Buffer): void {
    if (this.allClientsDraining) {
      return;
    }

    for (const state of this.dataClients.values()) {
      if (state.draining) {
        continue;
      }
      this.writeOutput(state, sessionID, data);
    }
  }

  private writeControl(socket: net.Socket, message: DaemonMessage): void {
    writeControlMessage(socket, message);
  }

  private writeOutput(state: DataClientState, sessionID: string, data: Buffer): void {
    const flushed = writeOutputFrame(state.socket, sessionID, data);
    if (!flushed) {
      state.draining = true;
      this.updateAllClientsDraining();
    } else if (state.draining) {
      state.draining = false;
      this.updateAllClientsDraining();
    }
  }

  private updateAllClientsDraining(): void {
    const previous = this.allClientsDraining;

    if (this.dataClients.size === 0) {
      this.allClientsDraining = false;
    } else {
      this.allClientsDraining = Array.from(this.dataClients.values()).every((state) => state.draining);
    }

    if (previous !== this.allClientsDraining) {
      this.processManager.setOutputsPaused(this.allClientsDraining);
      logger.info(
        {
          tag: "BACKPRESSURE",
          allClientsDraining: this.allClientsDraining,
          dataClients: this.dataClients.size,
        },
        "updated global output pause state",
      );
    }
  }
}
