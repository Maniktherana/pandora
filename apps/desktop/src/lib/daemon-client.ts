/**
 * DaemonClient — workspace-scoped daemon communication via Tauri IPC.
 *
 * Messages are routed through the Rust backend which manages per-workspace
 * daemon processes and socket connections.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ClientMessage, DaemonMessage } from "./types";

export type ConnectionState = "disconnected" | "connecting" | "connected";

export interface DaemonClientCallbacks {
  onConnectionStateChange: (workspaceId: string, state: ConnectionState) => void;
  onSlotSnapshot: (workspaceId: string, slots: import("./types").SlotState[]) => void;
  onSessionSnapshot: (workspaceId: string, sessions: import("./types").SessionState[]) => void;
  onSlotStateChanged: (workspaceId: string, slot: import("./types").SlotState) => void;
  onSessionStateChanged: (workspaceId: string, session: import("./types").SessionState) => void;
  onSlotAdded: (workspaceId: string, slot: import("./types").SlotState) => void;
  onSlotRemoved: (workspaceId: string, slotID: string) => void;
  onSessionOpened: (workspaceId: string, session: import("./types").SessionState) => void;
  onSessionClosed: (workspaceId: string, sessionID: string) => void;
  onOutputChunk?: (workspaceId: string, sessionID: string, data: string) => void;
  onError: (workspaceId: string, message: string) => void;
}

export class DaemonClient {
  private callbacks: DaemonClientCallbacks;
  private unlisteners: UnlistenFn[] = [];

  constructor(callbacks: DaemonClientCallbacks) {
    this.callbacks = callbacks;
  }

  async connect() {
    // Listen for workspace-scoped connection state changes
    const unlisten1 = await listen<string>("daemon-connection", (event) => {
      try {
        const data = JSON.parse(event.payload);
        const workspaceId = data.workspaceId as string;
        const state = data.state as ConnectionState;
        this.callbacks.onConnectionStateChange(workspaceId, state);
      } catch {
        // ignore parse errors
      }
    });

    // Listen for daemon messages (JSON with workspaceId injected by Rust)
    const unlisten2 = await listen<string>("daemon-message", (event) => {
      try {
        const message = JSON.parse(event.payload) as DaemonMessage;
        const workspaceId = message.workspaceId ?? "";
        this.handleMessage(workspaceId, message);
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
  }

  async send(workspaceId: string, message: ClientMessage) {
    try {
      await invoke("daemon_send", {
        workspaceId,
        message: JSON.stringify(message),
      });
    } catch {
      // Not connected yet — silently drop
    }
  }

  input(workspaceId: string, sessionID: string, data: string) {
    void this.send(workspaceId, { type: "input", sessionID, data });
  }

  resize(workspaceId: string, sessionID: string, cols: number, rows: number) {
    void this.send(workspaceId, { type: "resize", sessionID, cols, rows });
  }

  openSessionInstance(workspaceId: string, sessionDefID: string) {
    void this.send(workspaceId, { type: "open_session_instance", sessionDefID });
  }

  private handleMessage(workspaceId: string, message: DaemonMessage) {
    switch (message.type) {
      case "slot_snapshot":
        this.callbacks.onSlotSnapshot(workspaceId, message.slots);
        break;
      case "session_snapshot":
        this.callbacks.onSessionSnapshot(workspaceId, message.sessions);
        break;
      case "slot_state_changed":
        this.callbacks.onSlotStateChanged(workspaceId, message.slot);
        break;
      case "session_state_changed":
        this.callbacks.onSessionStateChanged(workspaceId, message.session);
        break;
      case "slot_added":
        this.callbacks.onSlotAdded(workspaceId, message.slot);
        break;
      case "slot_removed":
        this.callbacks.onSlotRemoved(workspaceId, message.slotID);
        break;
      case "session_opened":
        this.callbacks.onSessionOpened(workspaceId, message.session);
        break;
      case "session_closed":
        this.callbacks.onSessionClosed(workspaceId, message.sessionID);
        break;
      case "output_chunk":
        this.callbacks.onOutputChunk?.(workspaceId, message.sessionID, message.data);
        break;
      case "error":
        this.callbacks.onError(workspaceId, message.message);
        break;
    }
  }
}
