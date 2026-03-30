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
  updateSlotDefinition
} from "./db";
import { ProcessManager } from "./process-manager";
import { createMessageReader, writeMessage } from "./protocol";
import type { ClientMessage, DaemonMessage, SessionState, SlotState } from "./types";

export class DaemonServer {
  private readonly db;
  private readonly clients = new Set<net.Socket>();
  private readonly processManager: ProcessManager;
  private readonly socketPath: string;
  private server: net.Server | null = null;

  constructor(workspacePath: string, defaultCwd?: string) {
    const normalizedPath = path.resolve(workspacePath);
    const hash = createHash("sha256").update(normalizedPath).digest("hex").slice(0, 8);
    this.socketPath = `/tmp/pandora-${hash}.sock`;
    this.db = openDatabase({
      workspacePath: normalizedPath,
      defaultCwd: defaultCwd ?? normalizedPath
    });

    const slotDefinitions = listSlotDefinitions(this.db);
    const sessionDefinitions = listSessionDefinitions(this.db);
    this.processManager = new ProcessManager(
      slotDefinitions,
      sessionDefinitions,
      (session) => this.broadcast({ type: "session_state_changed", session }),
      (sessionID, data) =>
        this.broadcast({
          type: "output_chunk",
          sessionID,
          data: data.toString("base64")
        })
    );
  }

  async start(): Promise<void> {
    if (existsSync(this.socketPath)) {
      const alreadyListening = await new Promise<boolean>((resolve) => {
        const client = net.createConnection(this.socketPath);
        const done = (value: boolean) => {
          client.removeAllListeners();
          client.destroy();
          resolve(value);
        };
        client.once("connect", () => done(true));
        client.once("error", () => done(false));
      });

      if (alreadyListening) {
        console.log(`pandorad already running on ${this.socketPath}`);
        return;
      }

      unlinkSync(this.socketPath);
    }
    try {
      await this.processManager.autostartSlots();
    } catch (error) {
      this.processManager.closeAllSessions();
      throw error;
    }

    this.server = net.createServer((socket) => this.handleConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.socketPath, resolve);
    });

    console.log(`pandorad listening on ${this.socketPath}`);
  }

  async stop(): Promise<void> {
    this.processManager.closeAllSessions();

    for (const client of this.clients) {
      client.destroy();
    }
    this.clients.clear();

    if (this.server) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()));
      this.server = null;
    }

    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }
    this.db.close();
  }

  private handleConnection(socket: net.Socket): void {
    this.clients.add(socket);
    writeMessage(socket, { type: "slot_snapshot", slots: this.processManager.listSlotStates() });
    writeMessage(socket, { type: "session_snapshot", sessions: this.processManager.listSessionStates() });

    const reader = createMessageReader(
      (message) => {
        this.handleMessage(socket, message as ClientMessage);
      },
      (error) => {
        writeMessage(socket, { type: "error", message: error.message });
      }
    );

    socket.on("data", reader);
    socket.on("close", () => {
      this.clients.delete(socket);
    });
    socket.on("error", () => {
      this.clients.delete(socket);
    });
  }

  private handleMessage(socket: net.Socket, message: ClientMessage): void {
    switch (message.type) {
      case "create_slot": {
        const slot = createSlotDefinition(this.db, {
          id: message.slot.id,
          kind: message.slot.kind,
          name: message.slot.name,
          autostart: message.slot.autostart,
          presentationMode: message.slot.presentationMode,
          primarySessionDefID: message.slot.primarySessionDefID ?? null,
          persisted: message.slot.persisted,
          sortOrder: message.slot.sortOrder
        });
        this.processManager.registerSlot(slot);
        this.broadcast({ type: "slot_added", slot: this.findSlotState(slot.id) });
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
          sortOrder: message.slot.sortOrder
        });
        this.broadcast({ type: "slot_state_changed", slot: this.findSlotState(message.slot.id) });
        break;
      case "remove_slot":
        this.processManager.removeSlot(message.slotID);
        removeSlotDefinition(this.db, message.slotID);
        this.broadcast({ type: "slot_removed", slotID: message.slotID });
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
          resumeSupported: message.session.resumeSupported
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
          resumeSupported: message.session.resumeSupported
        });
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
          this.broadcast({ type: "session_opened", session });
          this.broadcastSnapshots();
        }
        break;
      }
      case "close_session_instance":
        this.processManager.closeSession(message.sessionID);
        this.broadcast({ type: "session_closed", sessionID: message.sessionID });
        this.broadcastSnapshots();
        break;
      case "input":
        this.processManager.writeToSession(message.sessionID, Buffer.from(message.data, "base64"));
        break;
      case "resize":
        this.processManager.resizeSession(message.sessionID, message.cols, message.rows);
        break;
      default:
        writeMessage(socket, { type: "error", message: "Unsupported message" });
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
    this.broadcast({ type: "slot_snapshot", slots: this.processManager.listSlotStates() });
    this.broadcast({ type: "session_snapshot", sessions: this.processManager.listSessionStates() });
  }

  private broadcast(message: DaemonMessage): void {
    for (const client of this.clients) {
      writeMessage(client, message);
    }
  }
}
