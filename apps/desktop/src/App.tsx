import { useEffect, useRef, useState, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import WorkspaceView from "@/components/WorkspaceView";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { DaemonClient } from "@/lib/daemon-client";
import { cn } from "@/lib/utils";
import { PanelLeft, Plus } from "lucide-react";

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const clientRef = useRef<DaemonClient | null>(null);
  const store = useWorkspaceStore;
  const hasSeededRef = useRef<Set<string>>(new Set());

  // Load persisted app state on mount
  useEffect(() => {
    void store.getState().loadAppState().then(() => {
      // After loading, auto-select and start runtime for the selected workspace
      const { selectedWorkspaceID, workspaces } = store.getState();
      if (selectedWorkspaceID) {
        const ws = workspaces.find((w) => w.id === selectedWorkspaceID);
        if (ws && ws.status === "ready") {
          store.getState().selectWorkspace(ws);
        }
      }
    });
  }, []);

  // Initialize workspace-scoped daemon client
  useEffect(() => {
    const client = new DaemonClient({
      onConnectionStateChange: (workspaceId, state) => {
        store.getState().setRuntimeConnectionState(workspaceId, state);
      },
      onSlotSnapshot: (workspaceId, slots) => {
        store.getState().setRuntimeSlots(workspaceId, slots);
        // Auto-open session instances for terminal slots
        for (const slot of slots) {
          if (slot.kind === "terminal_slot" && slot.sessionIDs.length === 0 && slot.sessionDefIDs.length > 0) {
            client.openSessionInstance(workspaceId, slot.sessionDefIDs[0]);
          }
        }
        // Auto-seed first terminal if snapshot is empty
        if (slots.length === 0 && !hasSeededRef.current.has(workspaceId)) {
          hasSeededRef.current.add(workspaceId);
          seedFirstTerminal(client, workspaceId);
        }
      },
      onSessionSnapshot: (workspaceId, sessions) => {
        store.getState().setRuntimeSessions(workspaceId, sessions);
      },
      onSlotStateChanged: (workspaceId, slot) => {
        store.getState().updateRuntimeSlot(workspaceId, slot);
      },
      onSessionStateChanged: (workspaceId, session) => {
        store.getState().updateRuntimeSession(workspaceId, session);
      },
      onSlotAdded: (workspaceId, slot) => {
        store.getState().addRuntimeSlot(workspaceId, slot);
      },
      onSlotRemoved: (workspaceId, slotID) => {
        store.getState().removeRuntimeSlot(workspaceId, slotID);
      },
      onSessionOpened: (workspaceId, session) => {
        store.getState().addRuntimeSession(workspaceId, session);
      },
      onSessionClosed: (workspaceId, sessionID) => {
        store.getState().removeRuntimeSession(workspaceId, sessionID);
      },
      onOutputChunk: () => {},
      onError: (workspaceId, message) => {
        console.error(`Daemon error [${workspaceId}]:`, message);
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
    const { selectedWorkspaceID } = store.getState();
    if (!client || !selectedWorkspaceID) return;
    seedTerminal(client, selectedWorkspaceID);
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const {
        navigationArea,
        navigateSidebar,
        selectWorkspace,
        setNavigationArea,
        selectedWorkspaceID,
        workspaces,
        cycleTab,
      } = store.getState();

      if (e.metaKey) {
        switch (e.key) {
          case "[":
            e.preventDefault();
            cycleTab(-1);
            break;
          case "]":
            e.preventDefault();
            cycleTab(1);
            break;
          case "ArrowLeft":
            e.preventDefault();
            setNavigationArea("sidebar");
            break;
          case "ArrowRight":
            e.preventDefault();
            if (navigationArea === "sidebar" && selectedWorkspaceID) {
              const ws = workspaces.find((w) => w.id === selectedWorkspaceID);
              if (ws) selectWorkspace(ws);
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
          case "t":
            if (e.shiftKey) {
              e.preventDefault();
              handleNewTerminal();
            }
            break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNewTerminal]);

  const selectedWs = useWorkspaceStore((s) => s.selectedWorkspace());
  const runtime = useWorkspaceStore((s) =>
    s.selectedWorkspaceID ? s.runtimes[s.selectedWorkspaceID] : null
  );
  const connectionState = runtime?.connectionState ?? "disconnected";

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-950/90">
      {/* Sidebar */}
      {sidebarVisible && (
        <div className="w-56 shrink-0 h-full">
          <Sidebar onCollapse={() => setSidebarVisible(false)} />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {/* Top bar */}
        <div
          className="h-10 flex items-center shrink-0 border-b border-neutral-800"
          data-tauri-drag-region
        >
          {!sidebarVisible && (
            <button
              onClick={() => setSidebarVisible(true)}
              className="ml-20 p-1.5 rounded-md hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              <PanelLeft className="w-4 h-4" />
            </button>
          )}
          {selectedWs && (
            <div className="flex items-center gap-2 ml-3" data-tauri-drag-region>
              <span className="text-sm text-neutral-400" data-tauri-drag-region>
                {selectedWs.name}
              </span>
              {selectedWs.status === "ready" && (
                <button
                  onClick={handleNewTerminal}
                  className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
                  title="New Terminal (Cmd+Shift+T)"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Workspace area */}
        <div className="flex-1 min-h-0">
          <WorkspaceView />
        </div>

        {/* Status bar */}
        <div className="h-6 flex items-center px-3 border-t border-neutral-800 bg-neutral-900/50 text-[11px] text-neutral-500 shrink-0">
          {selectedWs?.status === "ready" && (
            <>
              <div
                className={cn(
                  "w-1.5 h-1.5 rounded-full mr-2",
                  connectionState === "connected"
                    ? "bg-green-500"
                    : connectionState === "connecting"
                    ? "bg-yellow-500"
                    : "bg-red-500"
                )}
              />
              <span>
                {connectionState === "connected"
                  ? "Connected"
                  : connectionState === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
              </span>
            </>
          )}
          {selectedWs && selectedWs.status !== "ready" && (
            <span className="capitalize">{selectedWs.status}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Terminal seeding helpers ───

let terminalCounter = 0;

function seedFirstTerminal(client: DaemonClient, workspaceId: string) {
  seedTerminalWithName(client, workspaceId, "Local Terminal");
}

function seedTerminal(client: DaemonClient, workspaceId: string) {
  terminalCounter++;
  seedTerminalWithName(client, workspaceId, `Terminal ${terminalCounter}`);
}

function seedTerminalWithName(client: DaemonClient, workspaceId: string, name: string) {
  const slotID = crypto.randomUUID();
  const sessionDefID = crypto.randomUUID();
  const shell = "/bin/zsh";

  client.send(workspaceId, {
    type: "create_slot",
    slot: {
      id: slotID,
      kind: "terminal_slot",
      name,
      autostart: true,
      presentationMode: "single",
      primarySessionDefID: sessionDefID,
      sessionDefIDs: [sessionDefID],
      persisted: false,
      sortOrder: Date.now(),
    },
  });

  client.send(workspaceId, {
    type: "create_session_def",
    session: {
      id: sessionDefID,
      slotID,
      kind: "terminal",
      name,
      command: `exec ${shell} -i`,
      cwd: null,
      port: null,
      envOverrides: {},
      restartPolicy: "manual",
      pauseSupported: false,
      resumeSupported: false,
    },
  });

  setTimeout(() => client.openSessionInstance(workspaceId, sessionDefID), 100);
}
