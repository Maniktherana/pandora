import { useEffect, useRef, useState, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import WorkspaceView, { feedTerminalOutput } from "@/components/WorkspaceView";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { DaemonClient } from "@/lib/daemon-client";
import { cn } from "@/lib/utils";
import { PanelLeft } from "lucide-react";

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const clientRef = useRef<DaemonClient | null>(null);
  const store = useWorkspaceStore;

  useEffect(() => {
    const client = new DaemonClient({
      onConnectionStateChange: (state) => {
        store.getState().setConnectionState(state);
      },
      onSlotSnapshot: (slots) => {
        store.getState().setSlots(slots);
        // Auto-open session instances for terminal slots
        for (const slot of slots) {
          if (slot.kind === "terminal_slot" && slot.sessionIDs.length === 0 && slot.sessionDefIDs.length > 0) {
            client.openSessionInstance(slot.sessionDefIDs[0]);
          }
        }
      },
      onSessionSnapshot: (sessions) => {
        store.getState().setSessions(sessions);
      },
      onSlotStateChanged: (slot) => {
        store.getState().updateSlot(slot);
      },
      onSessionStateChanged: (session) => {
        store.getState().updateSession(session);
      },
      onSlotAdded: (slot) => {
        store.getState().addSlot(slot);
      },
      onSlotRemoved: (slotID) => {
        store.getState().removeSlot(slotID);
      },
      onSessionOpened: (session) => {
        store.getState().addSession(session);
      },
      onSessionClosed: (sessionID) => {
        store.getState().removeSession(sessionID);
      },
      onOutputChunk: (sessionID, data) => {
        feedTerminalOutput(sessionID, data);
      },
      onError: (message) => {
        console.error("Daemon error:", message);
      },
    });

    clientRef.current = client;
    (window as any).__daemonClient = client;
    void client.connect();

    return () => {
      client.disconnect();
      (window as any).__daemonClient = null;
    };
  }, []);

  const handleNewTerminal = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;

    // Create a new terminal slot via the daemon
    const slotID = crypto.randomUUID();
    const sessionDefID = crypto.randomUUID();

    client.send({
      type: "create_slot",
      slot: {
        id: slotID,
        kind: "terminal_slot",
        name: "Terminal",
        autostart: false,
        presentationMode: "single",
        primarySessionDefID: sessionDefID,
        sessionDefIDs: [sessionDefID],
        persisted: false,
        sortOrder: Date.now(),
      },
    });

    client.send({
      type: "create_session_def",
      session: {
        id: sessionDefID,
        slotID,
        kind: "terminal",
        name: "Shell",
        command: "/bin/zsh",
        cwd: null,
        port: null,
        envOverrides: {},
        restartPolicy: "manual",
        pauseSupported: false,
        resumeSupported: false,
      },
    });

    // Open an instance
    setTimeout(() => client.openSessionInstance(sessionDefID), 100);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { navigationArea, navigateSidebar, selectWorkspace, setNavigationArea, selectedSidebarWorkspaceID } =
        store.getState();

      if (e.metaKey) {
        switch (e.key) {
          case "w":
            e.preventDefault();
            // Close focused tab
            break;
          case "[":
            e.preventDefault();
            // Cycle tabs backward
            break;
          case "]":
            e.preventDefault();
            // Cycle tabs forward
            break;
          case "ArrowLeft":
            e.preventDefault();
            setNavigationArea("sidebar");
            break;
          case "ArrowRight":
            e.preventDefault();
            if (navigationArea === "sidebar" && selectedSidebarWorkspaceID) {
              selectWorkspace(selectedSidebarWorkspaceID);
              setNavigationArea("workspace");
            }
            break;
          case "ArrowUp":
            e.preventDefault();
            if (navigationArea === "sidebar") navigateSidebar(-1);
            break;
          case "ArrowDown":
            e.preventDefault();
            if (navigationArea === "sidebar") navigateSidebar(1);
            break;
          case "b":
            e.preventDefault();
            setSidebarVisible((v) => !v);
            break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const connectionState = useWorkspaceStore((s) => s.connectionState);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950/90">
      {/* Sidebar */}
      {sidebarVisible && (
        <div className="w-56 shrink-0 h-full">
          <Sidebar onCollapse={() => setSidebarVisible(false)} onNewTerminal={handleNewTerminal} />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Top bar — always present for drag region; shows toggle when sidebar hidden */}
        <div className="h-10 flex items-center shrink-0 border-b border-neutral-800" data-tauri-drag-region>
          {!sidebarVisible && (
            <button
              onClick={() => setSidebarVisible(true)}
              className="ml-20 p-1.5 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Workspace area */}
        <div className="flex-1 min-h-0">
          <WorkspaceView />
        </div>

        {/* Status bar */}
        <div className="h-6 flex items-center px-3 border-t border-neutral-800 bg-neutral-900/50 text-[11px] text-neutral-500 shrink-0">
          <div className={cn(
            "w-1.5 h-1.5 rounded-full mr-2",
            connectionState === "connected" ? "bg-green-500" : connectionState === "connecting" ? "bg-yellow-500" : "bg-red-500"
          )} />
          <span>{connectionState === "connected" ? "Connected" : connectionState === "connecting" ? "Connecting..." : "Disconnected"}</span>
        </div>
      </div>
    </div>
  );
}
