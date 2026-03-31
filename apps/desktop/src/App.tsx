import { useEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import Sidebar from "@/components/Sidebar";
import WorkspaceView from "@/components/WorkspaceView";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { DaemonClient } from "@/lib/daemon-client";
import { publishTerminalOutput, setTerminalDaemonClient } from "@/lib/terminal-runtime";
import { cn } from "@/lib/utils";
import type { LayoutNode, LayoutLeaf } from "@/lib/types";
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
        // On first connect the daemon may return stale slots from a previous session.
        // Ignore them and start fresh with a single terminal.
        if (!hasSeededRef.current.has(workspaceId)) {
          hasSeededRef.current.add(workspaceId);
          // Clear any stale persisted slots
          for (const slot of slots) {
            client.send(workspaceId, { type: "remove_slot", slotID: slot.id });
          }
          store.getState().setRuntimeSlots(workspaceId, []);
          seedFirstTerminal(client, workspaceId);
          return;
        }
        store.getState().setRuntimeSlots(workspaceId, slots);
        // Auto-open session instances for terminal slots that need them
        for (const slot of slots) {
          if (slot.kind === "terminal_slot" && slot.sessionIDs.length === 0 && slot.sessionDefIDs.length > 0) {
            client.openSessionInstance(workspaceId, slot.sessionDefIDs[0]);
          }
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
      onOutputChunk: (_workspaceId, sessionID, data) => {
        publishTerminalOutput(sessionID, data);
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
      (window as any).__daemonClient = null;
      setTerminalDaemonClient(null);
    };
  }, []);

  const handleNewTerminal = useCallback(() => {
    const client = clientRef.current;
    const { selectedWorkspaceID } = store.getState();
    if (!client || !selectedWorkspaceID) return;
    seedTerminal(client, selectedWorkspaceID);
  }, []);

  const handleCloseFocusedTab = useCallback(() => {
    const client = clientRef.current;
    const state = store.getState();
    const workspaceId = state.selectedWorkspaceID;
    if (!client || !workspaceId) return;

    const runtime = state.runtimes[workspaceId];
    if (!runtime?.root || !runtime.focusedPaneID) return;

    const leaf = findLeaf(runtime.root, runtime.focusedPaneID);
    if (!leaf) return;

    const activeSlotId = leaf.slotIDs[leaf.selectedIndex] ?? leaf.slotIDs[0];
    if (!activeSlotId) return;

    client.send(workspaceId, {
      type: "remove_slot",
      slotID: activeSlotId,
    });
  }, []);

  // Global keyboard shortcuts — use capture phase so app shortcuts fire
  // before the terminal's InputHandler can consume/stopPropagation on them.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const {
        navigationArea,
        navigateSidebar,
        selectWorkspace,
        setNavigationArea,
        selectedWorkspaceID,
        workspaces,
      } = store.getState();

      if (e.metaKey) {
        switch (e.key) {
          case "[":
            if (e.shiftKey) {
              e.preventDefault();
              store.getState().cycleTab(-1);
            }
            break;
          case "]":
            if (e.shiftKey) {
              e.preventDefault();
              store.getState().cycleTab(1);
            }
            break;
          case "ArrowLeft":
            // Only intercept for sidebar navigation, not when in workspace (terminal needs Cmd+Arrow)
            if (navigationArea === "sidebar") {
              e.preventDefault();
            }
            break;
          case "ArrowRight":
            if (navigationArea === "sidebar" && selectedWorkspaceID) {
              e.preventDefault();
              const ws = workspaces.find((w) => w.id === selectedWorkspaceID);
              if (ws) selectWorkspace(ws);
              setNavigationArea("workspace");
            }
            break;
          case "ArrowUp":
            if (navigationArea === "sidebar") {
              e.preventDefault();
              navigateSidebar(-1);
            }
            break;
          case "ArrowDown":
            if (navigationArea === "sidebar") {
              e.preventDefault();
              navigateSidebar(1);
            }
            break;
          case "b":
            e.preventDefault();
            setSidebarVisible((v) => !v);
            break;
          case "t":
            // Cmd+T — new terminal (Cmd+Shift+T also works)
            e.preventDefault();
            handleNewTerminal();
            break;
          case "w":
            // Cmd+W — close focused tab
            e.preventDefault();
            handleCloseFocusedTab();
            break;
        }
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [handleNewTerminal]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<string>("app-shortcut", (event) => {
      switch (event.payload) {
        case "close-tab":
          handleCloseFocusedTab();
          break;
        case "previous-tab":
          store.getState().cycleTab(1);
          break;
        case "next-tab":
          store.getState().cycleTab(-1);
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [handleCloseFocusedTab]);

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

function findLeaf(node: LayoutNode, paneID: string): LayoutLeaf | null {
  if (node.type === "leaf") return node.id === paneID ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, paneID);
    if (found) return found;
  }
  return null;
}
