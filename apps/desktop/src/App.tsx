import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ImperativePanelHandle,
  PanelResizeHandle,
} from "react-resizable-panels";
import Sidebar from "@/components/navigation/sidebar";
import BottomPanel from "@/components/panels/bottom-panel";
import WorkspaceFileTreePanel from "@/components/files/workspace-file-tree-panel";
import { TabDragProvider } from "@/components/dnd/tab-drag-layer";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import WorkspaceView from "@/components/workspace/workspace-view";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { tryCloseEditorTab } from "@/lib/editor/close-dirty-editor";
import { findLeaf } from "@/lib/layout/layout-migrate";
import { DaemonClient } from "@/lib/runtime/daemon-client";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { cn } from "@/lib/shared/utils";
import {
  seedProjectTerminal,
  seedWorkspaceTerminal,
} from "@/lib/terminal/terminal-seed";
import { setTerminalDaemonClient } from "@/lib/terminal/terminal-runtime";
import { Eye, FolderTree, PanelBottom, PanelLeft, PencilLine, Plus } from "lucide-react";
import {
  loadPersistedSidebarVisible,
  persistSidebarVisible,
  loadFileTreeOpenForWorkspace,
  persistFileTreeOpenForWorkspace,
} from "@/lib/workspace/ui-persistence";

export default function App() {
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(224);
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

  useEffect(() => {
    void store.getState().loadAppState().then(() => {
      const { selectedWorkspaceID, workspaces } = store.getState();
      if (selectedWorkspaceID) {
        const ws = workspaces.find((w) => w.id === selectedWorkspaceID);
        if (ws && ws.status === "ready") {
          store.getState().selectWorkspace(ws);
        }
      }
    });
  }, []);

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
        clearPendingStoppedTerminalRemovals(
          workspaceId,
          slots.map((slot) => slot.id)
        );
        store.getState().setRuntimeSlots(workspaceId, slots);
        if (slots.length === 0) {
          if (workspaceId.startsWith("project:")) {
            const seeded = seedProjectTerminal(client, workspaceId);
            store.getState().addProjectTerminalGroup(workspaceId, seeded.slotID);
          } else {
            seedWorkspaceTerminal(client, workspaceId);
          }
          return;
        }
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

  const handleNewWorkspaceTerminal = useCallback(() => {
    const client = clientRef.current;
    const { selectedWorkspaceID } = store.getState();
    if (!client || !selectedWorkspaceID) return;
    seedWorkspaceTerminal(client, selectedWorkspaceID);
  }, []);

  const handleNewTerminalShortcut = useCallback(() => {
    const client = clientRef.current;
    const state = store.getState();
    const runtimeId = state.effectiveLayoutRuntimeId() ?? state.selectedWorkspaceID;
    if (!client || !runtimeId) return;

    if (isProjectRuntimeKey(runtimeId)) {
      const seeded = seedProjectTerminal(client, runtimeId);
      state.addProjectTerminalGroup(runtimeId, seeded.slotID);
      state.setProjectTerminalPanelVisible(runtimeId, true);
      return;
    }

    seedWorkspaceTerminal(client, runtimeId);
  }, []);

  const handleNewTerminalShortcutRef = useRef(handleNewTerminalShortcut);
  handleNewTerminalShortcutRef.current = handleNewTerminalShortcut;
  const setSidebarVisibleRef = useRef(setSidebarVisible);
  setSidebarVisibleRef.current = setSidebarVisible;
  const handleSidebarResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = Math.min(360, Math.max(180, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(nextWidth);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [sidebarWidth]);

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
            e.preventDefault();
            handleNewTerminalShortcut();
            break;
          case "w":
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
  }, [handleNewTerminalShortcut, handleCloseFocusedTab, toggleBottomPanel]);

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
          handleNewTerminalShortcutRef.current();
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
  const presentationMode = useWorkspaceStore((s) => s.presentationMode);
  const setPresentationMode = useWorkspaceStore((s) => s.setPresentationMode);
  const runtime = useWorkspaceStore((s) =>
    s.selectedWorkspaceID ? s.runtimes[s.selectedWorkspaceID] : null
  );
  const connectionState = runtime?.connectionState ?? "disconnected";

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
      {sidebarVisible && (
        <div className="relative h-full shrink-0 bg-transparent" style={{ width: sidebarWidth }}>
            <Sidebar onCollapse={() => setSidebarVisible(false)} />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={handleSidebarResizeStart}
            className="group absolute inset-y-0 right-0 z-20 w-px cursor-col-resize bg-transparent"
          >
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[var(--oc-text-subtle)] to-transparent opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          </div>
        </div>
      )}

      <div className="flex h-full min-w-0 flex-1 flex-col bg-[#151515]">
          <div className="h-10 flex items-center shrink-0 border-b border-[var(--oc-border)] bg-[#121212]">
            {!sidebarVisible && (
              <button
                onClick={() => setSidebarVisible(true)}
                className="ml-20 rounded-md p-1.5 text-[var(--oc-text-muted)] transition-colors hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
            {selectedWs && (
              <div className="flex items-center gap-2 ml-3" data-tauri-drag-region>
                <span className="text-sm text-[var(--oc-text-muted)]" data-tauri-drag-region>
                  {selectedWs.name}
                </span>
                {selectedWs.status === "ready" && (
                  <button
                    onClick={handleNewWorkspaceTerminal}
                    className="rounded p-1 text-[var(--oc-text-subtle)] transition-colors hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text-muted)]"
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
                <div className="mr-2 inline-flex items-center rounded-md border border-[var(--oc-border)] bg-[var(--oc-panel)] p-0.5">
                  <button
                    type="button"
                    onClick={() => setPresentationMode("edit")}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-[var(--oc-text-muted)] transition-colors hover:text-[var(--oc-text)]",
                      presentationMode === "edit" &&
                        "bg-[var(--oc-panel-elevated)] text-[var(--oc-text)]"
                    )}
                    title="Edit mode"
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresentationMode("review")}
                    className={cn(
                      "inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-[var(--oc-text-muted)] transition-colors hover:text-[var(--oc-text)]",
                      presentationMode === "review" &&
                        "bg-[var(--oc-panel-elevated)] text-[var(--oc-text)]"
                    )}
                    title="Review mode"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>Review</span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={toggleBottomPanel}
                  className={cn(
                    "rounded-md p-1.5 text-[var(--oc-text-muted)] transition-colors hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]",
                    bottomPanelOpen && "bg-[var(--oc-panel-elevated)] text-[var(--oc-text)]"
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
                    "rounded-md p-1.5 text-[var(--oc-text-muted)] transition-colors hover:bg-[var(--oc-panel-hover)] hover:text-[var(--oc-text)]",
                    fileTreeOpen && "bg-[var(--oc-panel-elevated)] text-[var(--oc-text)]"
                  )}
                  title="Toggle file tree"
                >
                  <FolderTree className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

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
                        "z-20 w-[2px] min-w-[2px] max-w-[2px] shrink-0 bg-[var(--oc-text-faint)] transition-colors hover:bg-[var(--oc-interactive)]",
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
                        "z-20 h-[2px] min-h-[2px] max-h-[2px] w-full shrink-0 bg-[var(--oc-text-faint)] transition-colors hover:bg-[var(--oc-interactive)]",
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

          <div className="flex h-6 shrink-0 items-center gap-3 border-t border-[var(--oc-border)] bg-[#121212] px-3 text-[11px] text-[var(--oc-text-subtle)]">
            <div className="flex items-center min-w-0">
              {selectedWs?.status === "ready" && (
                <>
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full mr-2 shrink-0",
                      connectionState === "connected"
                        ? "bg-[var(--oc-success)]"
                        : connectionState === "connecting"
                          ? "bg-[var(--oc-warning)]"
                          : "bg-[var(--oc-error)]"
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
