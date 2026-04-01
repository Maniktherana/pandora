import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ImperativePanelHandle,
  PanelResizeHandle,
} from "react-resizable-panels";
import Sidebar from "@/components/Sidebar";
import WorkspaceView from "@/components/WorkspaceView";
import WorkspaceFileTreePanel from "@/components/WorkspaceFileTreePanel";
import BottomPanel from "@/components/BottomPanel";
import { TabDragProvider } from "@/components/dnd/TabDragLayer";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { DaemonClient } from "@/lib/daemon-client";
import { setTerminalDaemonClient } from "@/lib/terminal-runtime";
import { cn } from "@/lib/utils";
import { findLeaf } from "@/lib/layout-migrate";
import { tryCloseEditorTab } from "@/lib/close-dirty-editor";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime-keys";
import {
  seedFirstProjectTerminal,
  seedFirstWorkspaceTerminal,
  seedProjectTerminal,
  seedWorkspaceTerminal,
} from "@/lib/terminal-seed";
import { FolderTree, PanelBottom, PanelLeft, Plus } from "lucide-react";
import {
  loadPersistedSidebarVisible,
  persistSidebarVisible,
  loadFileTreeOpenForWorkspace,
  persistFileTreeOpenForWorkspace,
} from "@/lib/ui-persistence";

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarPersistHydrated, setSidebarPersistHydrated] = useState(false);
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const fileTreePanelRef = useRef<ImperativePanelHandle>(null);
  const bottomPanelRef = useRef<ImperativePanelHandle>(null);
  const prevFileTreeWorkspaceIdRef = useRef<string | null>(null);
  const fileTreeLoadTicketRef = useRef(0);
  const clientRef = useRef<DaemonClient | null>(null);
  const pendingStoppedTerminalRemovalsRef = useRef(new Set<string>());
  const store = useWorkspaceStore;
  // Survives HMR so we don't re-seed terminals on hot reload.
  const hasSeeded = ((globalThis as any).__pandoraHasSeeded ??= new Set<string>()) as Set<string>;

  useEffect(() => {
    let cancelled = false;
    void loadPersistedSidebarVisible().then((visible) => {
      if (!cancelled) {
        setSidebarVisible(visible);
        setSidebarPersistHydrated(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sidebarPersistHydrated) return;
    void persistSidebarVisible(sidebarVisible);
  }, [sidebarVisible, sidebarPersistHydrated]);

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
    const scheduleStoppedTerminalRemoval = (
      workspaceId: string,
      session: { kind: string; status: string; slotID: string }
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
        // On first connect the daemon may return stale slots from a previous session.
        // Ignore them and start fresh with a single terminal.
        if (!hasSeeded.has(workspaceId)) {
          hasSeeded.add(workspaceId);
          // Clear any stale persisted slots
          for (const slot of slots) {
            client.send(workspaceId, { type: "remove_slot", slotID: slot.id });
          }
          store.getState().setRuntimeSlots(workspaceId, []);
          if (workspaceId.startsWith("project:")) {
            seedFirstProjectTerminal(client, workspaceId);
          } else {
            seedFirstWorkspaceTerminal(client, workspaceId);
          }
          return;
        }
        clearPendingStoppedTerminalRemovals(
          workspaceId,
          slots.map((slot) => slot.id)
        );
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
        for (const session of sessions) {
          scheduleStoppedTerminalRemoval(workspaceId, session);
        }
      },
      onSlotStateChanged: (workspaceId, slot) => {
        store.getState().updateRuntimeSlot(workspaceId, slot);
      },
      onSessionStateChanged: (workspaceId, session) => {
        store.getState().updateRuntimeSession(workspaceId, session);
        scheduleStoppedTerminalRemoval(workspaceId, session);
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
    seedWorkspaceTerminal(client, selectedWorkspaceID);
  }, []);

  const handleNewTerminalRef = useRef(handleNewTerminal);
  handleNewTerminalRef.current = handleNewTerminal;
  const setSidebarVisibleRef = useRef(setSidebarVisible);
  setSidebarVisibleRef.current = setSidebarVisible;

  const toggleBottomPanel = useCallback(() => {
    const state = store.getState();
    const project = state.selectedProject();
    const selectedWs = state.selectedWorkspace();
    if (!project || selectedWs?.status !== "ready") return;

    const projectKey = projectRuntimeKey(project.id);
    if (!bottomPanelOpen) {
      state.setProjectTerminalPanelVisible(projectKey, true);
      const runtime = state.runtimes[projectKey];
      if ((runtime?.terminalPanel?.groups.length ?? 0) === 0 && clientRef.current) {
        const seeded = seedProjectTerminal(clientRef.current, projectKey);
        state.addProjectTerminalGroup(projectKey, seeded.slotID);
      }
    }
    setBottomPanelOpen((v) => !v);
  }, [bottomPanelOpen]);

  const handleCloseFocusedTab = useCallback(() => {
    const client = clientRef.current;
    const state = store.getState();
    const runtimeId = state.effectiveLayoutRuntimeId();
    if (!runtimeId) return;

    const runtime = state.runtimes[runtimeId];
    if (!runtime) return;

    if (isProjectRuntimeKey(runtimeId)) {
      const slotId = runtime.terminalPanel?.activeSlotId;
      if (!slotId || !client) return;
      state.closeProjectTerminal(runtimeId, slotId);
      return;
    }

    if (!runtime.root || !runtime.focusedPaneID) return;

    const leaf = findLeaf(runtime.root, runtime.focusedPaneID);
    if (!leaf || leaf.tabs.length === 0) return;

    const idx = leaf.selectedIndex;
    const tab = leaf.tabs[idx] ?? leaf.tabs[0];
    if (tab.kind === "terminal") {
      if (!client) return;
      client.send(runtimeId, {
        type: "remove_slot",
        slotID: tab.slotId,
      });
    } else if (tab.kind === "diff") {
      store.getState().removePaneTabByIndex(runtime.focusedPaneID, idx);
    } else {
      if (isProjectRuntimeKey(runtimeId)) return;
      const ws = state.workspaces.find((w) => w.id === state.selectedWorkspaceID);
      if (!ws || ws.status !== "ready") return;
      const label = tab.path.split("/").pop() ?? tab.path;
      void tryCloseEditorTab({
        workspaceId: ws.id,
        workspaceRoot: ws.worktreePath,
        paneID: runtime.focusedPaneID,
        tabIndex: idx,
        relativePath: tab.path,
        displayName: label,
      });
    }
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

      if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "`") {
        e.preventDefault();
        toggleBottomPanel();
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [handleNewTerminal, handleCloseFocusedTab, toggleBottomPanel]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void listen<string>("app-shortcut", (event) => {
      switch (event.payload) {
        case "close-tab":
          handleCloseFocusedTab();
          break;
        case "previous-tab":
          store.getState().cycleTab(-1);
          break;
        case "next-tab":
          store.getState().cycleTab(1);
          break;
        case "new-terminal":
          handleNewTerminalRef.current();
          break;
        case "toggle-sidebar":
          setSidebarVisibleRef.current((v) => !v);
          break;
        case "toggle-bottom-terminal":
          toggleBottomPanel();
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [handleCloseFocusedTab, toggleBottomPanel]);

  const selectedWs = useWorkspaceStore((s) => s.selectedWorkspace());
  const runtime = useWorkspaceStore((s) =>
    s.selectedWorkspaceID ? s.runtimes[s.selectedWorkspaceID] : null
  );
  const connectionState = runtime?.connectionState ?? "disconnected";

  // Restore per-workspace file-tree open state (right panel). Avoid resetting on first hydrate
  // so launch does not flash closed-then-open.
  useEffect(() => {
    const id =
      selectedWs?.status === "ready" ? selectedWs.id : null;
    if (!id) {
      setFileTreeOpen(false);
      prevFileTreeWorkspaceIdRef.current = null;
      return;
    }

    const prev = prevFileTreeWorkspaceIdRef.current;
    prevFileTreeWorkspaceIdRef.current = id;
    if (prev !== null && prev !== id) {
      setFileTreeOpen(false);
    }

    const ticket = ++fileTreeLoadTicketRef.current;
    let cancelled = false;
    void loadFileTreeOpenForWorkspace(id).then((open) => {
      if (cancelled) return;
      if (fileTreeLoadTicketRef.current !== ticket) return;
      if (useWorkspaceStore.getState().selectedWorkspaceID !== id) return;
      setFileTreeOpen(open);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedWs?.id, selectedWs?.status]);

  // Keep WorkspaceView mounted: collapsing the file-tree panel instead of swapping trees avoids
  // destroying native Ghostty surfaces (which caused a full flash on every toggle).
  useLayoutEffect(() => {
    const p = fileTreePanelRef.current;
    if (!p) return;
    if (fileTreeOpen && selectedWs?.status === "ready") {
      p.expand(12);
    } else {
      p.collapse();
    }
  }, [fileTreeOpen, selectedWs?.status]);

  useLayoutEffect(() => {
    const p = bottomPanelRef.current;
    if (!p || selectedWs?.status !== "ready") return;
    if (bottomPanelOpen) {
      p.expand(28);
    } else {
      p.collapse();
    }
  }, [bottomPanelOpen, selectedWs?.status]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent">
      {/* Sidebar — column stays transparent so native window translucency / vibrancy shows through */}
      {sidebarVisible && (
        <div className="w-56 shrink-0 h-full bg-transparent">
          <Sidebar onCollapse={() => setSidebarVisible(false)} />
        </div>
      )}

      {/* Main content — opaque panel so workspace stays readable */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-neutral-950/90">
        {/* Top bar */}
        <div className="h-10 flex items-center shrink-0 border-b border-neutral-800">
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
          <div className="flex-1 min-w-8 self-stretch" data-tauri-drag-region />
          {selectedWs?.status === "ready" && (
            <div className="mr-3 flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={toggleBottomPanel}
                className={cn(
                  "p-1.5 rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors",
                  bottomPanelOpen && "bg-neutral-800 text-neutral-200"
                )}
                title="Toggle terminal panel (Ctrl+`)"
              >
                <PanelBottom className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  fileTreeLoadTicketRef.current += 1;
                  setFileTreeOpen((v) => {
                    const next = !v;
                    const ws = useWorkspaceStore.getState().selectedWorkspace();
                    if (ws?.status === "ready") {
                      void persistFileTreeOpenForWorkspace(ws.id, next);
                    }
                    return next;
                  });
                }}
                className={cn(
                  "p-1.5 rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors",
                  fileTreeOpen && "bg-neutral-800 text-neutral-200"
                )}
                title="Toggle file tree"
              >
                <FolderTree className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Workspace + optional bottom panel (TabDragProvider spans main + bottom terminals) */}
        <div className="flex-1 min-h-0 flex flex-col">
          <TabDragProvider>
            <ResizablePanelGroup direction="vertical" className="h-full min-h-0">
              <ResizablePanel defaultSize={72} minSize={35} className="min-h-0">
                <ResizablePanelGroup direction="horizontal" className="h-full min-h-0">
                  <ResizablePanel defaultSize={72} minSize={45}>
                    <div
                      className="h-full min-h-0 min-w-0"
                      onPointerDownCapture={() =>
                        useWorkspaceStore.getState().setLayoutTargetRuntimeId(null)
                      }
                    >
                      <WorkspaceView />
                    </div>
                  </ResizablePanel>
                  <PanelResizeHandle
                    hitAreaMargins={{ coarse: 0, fine: 0 }}
                    className={cn(
                      "z-20 w-[2px] min-w-[2px] max-w-[2px] shrink-0 bg-neutral-600 transition-colors hover:bg-blue-500",
                      fileTreeOpen && selectedWs?.status === "ready"
                        ? "cursor-col-resize"
                        : "hidden"
                    )}
                  />
                  <ResizablePanel
                    ref={fileTreePanelRef}
                    collapsible
                    collapsedSize={0}
                    defaultSize={28}
                    minSize={12}
                    maxSize={50}
                    className="min-h-0 min-w-0"
                  >
                    <div
                      className="h-full min-h-0 min-w-0"
                      onPointerDownCapture={() =>
                        useWorkspaceStore.getState().setLayoutTargetRuntimeId(null)
                      }
                    >
                      {fileTreeOpen && selectedWs?.status === "ready" ? (
                        <WorkspaceFileTreePanel
                          key={selectedWs.id}
                          workspaceRoot={selectedWs.worktreePath}
                          workspaceId={selectedWs.id}
                        />
                      ) : null}
                    </div>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              {selectedWs?.status === "ready" && (
                <>
                  <PanelResizeHandle
                    hitAreaMargins={{ coarse: 0, fine: 0 }}
                    className={cn(
                      "z-20 h-[2px] min-h-[2px] max-h-[2px] w-full shrink-0 bg-neutral-600 transition-colors hover:bg-blue-500",
                      bottomPanelOpen ? "cursor-row-resize" : "hidden"
                    )}
                  />
                  <ResizablePanel
                    ref={bottomPanelRef}
                    collapsible
                    collapsedSize={0}
                    defaultSize={28}
                    minSize={12}
                    maxSize={55}
                    className="min-h-0"
                  >
                    {bottomPanelOpen ? <BottomPanel /> : null}
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </TabDragProvider>
        </div>

        {/* Status bar */}
        <div className="h-6 flex items-center gap-3 px-3 border-t border-neutral-800 bg-neutral-900/50 text-[11px] text-neutral-500 shrink-0">
          <div className="flex items-center min-w-0">
            {selectedWs?.status === "ready" && (
              <>
                <div
                  className={cn(
                    "w-1.5 h-1.5 rounded-full mr-2 shrink-0",
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
    </div>
  );
}
