/**
 * DaemonClient — uses Tauri commands + events to talk to the daemon
 * via Unix socket (same approach as the Swift app's DaemonClient).
 *
 * No WebSocket middleman. The Rust backend owns the socket connection
 * and bridges it through Tauri's IPC.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ClientMessage, DaemonMessage } from "./types";

export type ConnectionState = "disconnected" | "connecting" | "connected" | "failed";

export interface DaemonClientCallbacks {
  onConnectionStateChange: (state: ConnectionState) => void;
  onSlotSnapshot: (slots: import("./types").SlotState[]) => void;
  onSessionSnapshot: (sessions: import("./types").SessionState[]) => void;
  onSlotStateChanged: (slot: import("./types").SlotState) => void;
  onSessionStateChanged: (session: import("./types").SessionState) => void;
  onSlotAdded: (slot: import("./types").SlotState) => void;
  onSlotRemoved: (slotID: string) => void;
  onSessionOpened: (session: import("./types").SessionState) => void;
  onSessionClosed: (sessionID: string) => void;
  onOutputChunk: (sessionID: string, data: string) => void;
  onError: (message: string) => void;
}

export class DaemonClient {
  private callbacks: DaemonClientCallbacks;
  private unlisteners: UnlistenFn[] = [];
  private _connectionState: ConnectionState = "disconnected";

  constructor(callbacks: DaemonClientCallbacks) {
    this.callbacks = callbacks;
  }

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  async connect() {
    this.setConnectionState("connecting");

    // Listen for daemon connection state changes
    const unlisten1 = await listen<string>("daemon-connection", (event) => {
      if (event.payload === "connected") {
        this.setConnectionState("connected");
      } else {
        this.setConnectionState("disconnected");
      }
    });

    // Listen for daemon messages (JSON strings from the Rust bridge)
    const unlisten2 = await listen<string>("daemon-message", (event) => {
      try {
        const message = JSON.parse(event.payload) as DaemonMessage;
        this.handleMessage(message);
      } catch (e) {
        console.error("Failed to parse daemon message:", e);
      }
    });

    this.unlisteners = [unlisten1, unlisten2];
  }

  disconnect() {
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];
    this.setConnectionState("disconnected");
  }

  async send(message: ClientMessage) {
    try {
      await invoke("daemon_send", { message: JSON.stringify(message) });
    } catch {
      // Not connected yet — silently drop
    }
  }

  input(sessionID: string, data: string) {
    void this.send({ type: "input", sessionID, data });
  }

  resize(sessionID: string, cols: number, rows: number) {
    void this.send({ type: "resize", sessionID, cols, rows });
  }

  openSessionInstance(sessionDefID: string) {
    void this.send({ type: "open_session_instance", sessionDefID });
  }

  closeSessionInstance(sessionID: string) {
    void this.send({ type: "close_session_instance", sessionID });
  }

  startSlot(slotID: string) {
    void this.send({ type: "start_slot", slotID });
  }

  stopSlot(slotID: string) {
    void this.send({ type: "stop_slot", slotID });
  }

  restartSlot(slotID: string) {
    void this.send({ type: "restart_slot", slotID });
  }

  private setConnectionState(state: ConnectionState) {
    this._connectionState = state;
    this.callbacks.onConnectionStateChange(state);
  }

  private handleMessage(message: DaemonMessage) {
    switch (message.type) {
      case "slot_snapshot":
        this.callbacks.onSlotSnapshot(message.slots);
        break;
      case "session_snapshot":
        this.callbacks.onSessionSnapshot(message.sessions);
        break;
      case "slot_state_changed":
        this.callbacks.onSlotStateChanged(message.slot);
        break;
      case "session_state_changed":
        this.callbacks.onSessionStateChanged(message.session);
        break;
      case "slot_added":
        this.callbacks.onSlotAdded(message.slot);
        break;
      case "slot_removed":
        this.callbacks.onSlotRemoved(message.slotID);
        break;
      case "session_opened":
        this.callbacks.onSessionOpened(message.session);
        break;
      case "session_closed":
        this.callbacks.onSessionClosed(message.sessionID);
        break;
      case "output_chunk":
        this.callbacks.onOutputChunk(message.sessionID, message.data);
        break;
      case "error":
        this.callbacks.onError(message.message);
        break;
    }
  }
}
