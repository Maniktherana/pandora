import { useEffect, useRef } from "react";
import { DaemonClient } from "@/lib/runtime/daemon-client";
import { setTerminalDaemonClient } from "@/lib/terminal/terminal-runtime";
import { useWorkspaceStore } from "@/stores/workspace-store";

type SessionSnapshot = {
  kind: string;
  status: string;
  slotID: string;
};

export default function useDaemonClient() {
  const clientRef = useRef<DaemonClient | null>(null);
  const pendingStoppedTerminalRemovalsRef = useRef(new Set<string>());
  const store = useWorkspaceStore;

  useEffect(() => {
    const scheduleStoppedTerminalRemoval = (
      client: DaemonClient,
      workspaceId: string,
      session: SessionSnapshot
    ) => {
      if (session.kind !== "terminal" || session.status !== "stopped") return;
      const key = `${workspaceId}:${session.slotID}`;
      if (pendingStoppedTerminalRemovalsRef.current.has(key)) return;
      pendingStoppedTerminalRemovalsRef.current.add(key);
      client.send(workspaceId, { type: "remove_slot", slotID: session.slotID });
    };

    const clearPendingStoppedTerminalRemovals = (
      workspaceId: string,
      liveSlotIds: Iterable<string>
    ) => {
      const live = new Set(liveSlotIds);
      for (const key of pendingStoppedTerminalRemovalsRef.current) {
        if (!key.startsWith(`${workspaceId}:`)) continue;
        const slotId = key.slice(workspaceId.length + 1);
        if (!live.has(slotId)) {
          pendingStoppedTerminalRemovalsRef.current.delete(key);
        }
      }
    };

    const client = new DaemonClient({
      onConnectionStateChange: (workspaceId, state) => {
        store.getState().setRuntimeConnectionState(workspaceId, state);
      },
      onSlotSnapshot: (workspaceId, slots) => {
        clearPendingStoppedTerminalRemovals(
          workspaceId,
          slots.map((slot) => slot.id)
        );
        store.getState().setRuntimeSlots(workspaceId, slots);
        if (slots.length === 0) return;
        for (const slot of slots) {
          if (
            slot.kind === "terminal_slot" &&
            slot.sessionIDs.length === 0 &&
            slot.sessionDefIDs.length > 0
          ) {
            client.openSessionInstance(workspaceId, slot.sessionDefIDs[0]);
          }
        }
      },
      onSessionSnapshot: (workspaceId, sessions) => {
        store.getState().setRuntimeSessions(workspaceId, sessions);
        for (const session of sessions) {
          scheduleStoppedTerminalRemoval(client, workspaceId, session);
        }
      },
      onSlotStateChanged: (workspaceId, slot) => {
        store.getState().updateRuntimeSlot(workspaceId, slot);
      },
      onSessionStateChanged: (workspaceId, session) => {
        store.getState().updateRuntimeSession(workspaceId, session);
        scheduleStoppedTerminalRemoval(client, workspaceId, session);
      },
      onSlotAdded: (workspaceId, slot) => {
        store.getState().addRuntimeSlot(workspaceId, slot);
      },
      onSlotRemoved: (workspaceId, slotID) => {
        pendingStoppedTerminalRemovalsRef.current.delete(`${workspaceId}:${slotID}`);
        store.getState().removeRuntimeSlot(workspaceId, slotID);
      },
      onSessionOpened: (workspaceId, session) => {
        store.getState().addRuntimeSession(workspaceId, session);
      },
      onSessionClosed: (workspaceId, sessionID) => {
        store.getState().removeRuntimeSession(workspaceId, sessionID);
      },
      onOutputChunk: (workspaceId, sessionID, data) => {
        const decoded = (() => {
          try {
            return atob(data);
          } catch {
            return data;
          }
        })();
        store.getState().noteTerminalOutput(workspaceId, sessionID, decoded);
      },
      onError: (workspaceId, message) => {
        console.error(`Daemon error [${workspaceId}]:`, message);
      },
    });

    clientRef.current = client;
    (window as any).__daemonClient = client;
    setTerminalDaemonClient(client);
    void client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
      (window as any).__daemonClient = null;
      setTerminalDaemonClient(null);
    };
  }, [store]);

  return clientRef;
}
