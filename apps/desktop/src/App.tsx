import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PanelResizeHandle, ImperativePanelHandle } from "react-resizable-panels";
import Sidebar from "@/components/navigation/sidebar";
import BottomPanel from "@/components/panels/bottom-panel";
import WorkspaceFileTreePanel from "@/components/files/workspace-file-tree-panel";
import { TabDragProvider } from "@/components/dnd/tab-drag-layer";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import WorkspaceView from "@/components/workspace/workspace-view";
import WorkspaceStack, {
  type WorkspaceStackItem,
} from "@/components/workspace/workspace-stack";
import ErrorBoundary from "@/components/error-boundary";
import AppToolbar from "@/components/layout/app-toolbar";
import AppStatusBar from "@/components/layout/app-status-bar";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { tryCloseEditorTab } from "@/lib/editor/close-dirty-editor";
import { findLeaf } from "@/lib/layout/layout-migrate";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { cn } from "@/lib/shared/utils";
import {
  seedProjectTerminal,
  seedWorkspaceTerminal,
} from "@/lib/terminal/terminal-seed";
import useDaemonClient from "@/hooks/use-daemon-client";
import useKeyboardShortcuts from "@/hooks/use-keyboard-shortcuts";
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
  const clientRef = useDaemonClient();
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
  }, [store]);

  const handleNewWorkspaceTerminal = useCallback(() => {
    const client = clientRef.current;
    const { selectedWorkspaceID } = store.getState();
    if (!client || !selectedWorkspaceID) return;
    seedWorkspaceTerminal(client, selectedWorkspaceID);
  }, [clientRef, store]);

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
  }, [clientRef, store]);

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
    if (!tab) return;

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
  }, [clientRef, store]);

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
  }, [bottomPanelOpen, clientRef, store]);

  const handleShowSidebar = useCallback(() => {
    setSidebarVisible(true);
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setSidebarVisible((v) => !v);
  }, []);

  useKeyboardShortcuts({
    onNewTerminal: handleNewTerminalShortcut,
    onCloseTab: handleCloseFocusedTab,
    onToggleSidebar: handleToggleSidebar,
    onToggleBottomPanel: toggleBottomPanel,
  });

  const selectedWs = useWorkspaceStore((s) => s.selectedWorkspace());
  const selectedWorkspaceID = useWorkspaceStore((s) => s.selectedWorkspaceID);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const runtimes = useWorkspaceStore((s) => s.runtimes);
  const runtime = useWorkspaceStore((s) =>
    s.selectedWorkspaceID ? s.runtimes[s.selectedWorkspaceID] : null
  );
  const connectionState = runtime?.connectionState ?? "disconnected";
  const selectedWorkspaceHasLayout = Boolean(
    selectedWs?.status === "ready" && runtime?.root
  );
  const workspaceStackItems = workspaces.reduce<WorkspaceStackItem[]>((items, workspace) => {
    if (workspace.status !== "ready") return items;
    const workspaceRuntime = runtimes[workspace.id];
    if (!workspaceRuntime?.root) return items;
    items.push({
      workspaceId: workspace.id,
      workspaceRoot: workspace.worktreePath,
      runtime: workspaceRuntime as WorkspaceStackItem["runtime"],
      isActive: workspace.id === selectedWorkspaceID,
    });
    return items;
  }, []);
  const shouldRenderWorkspaceStack =
    selectedWorkspaceHasLayout &&
    workspaceStackItems.some((item) => item.isActive);

  useEffect(() => {
    const id = selectedWs?.status === "ready" ? selectedWs.id : null;
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
            onPointerDown={(event) => {
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
            }}
            className="group absolute inset-y-0 right-0 z-20 w-px cursor-col-resize bg-transparent"
          >
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[var(--oc-text-subtle)] to-transparent opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          </div>
        </div>
      )}

      <div className="flex h-full min-w-0 flex-1 flex-col bg-[#151515]">
        <AppToolbar
          sidebarVisible={sidebarVisible}
          selectedWorkspace={selectedWs}
          bottomPanelOpen={bottomPanelOpen}
          fileTreeOpen={fileTreeOpen}
          onToggleSidebar={handleShowSidebar}
          onNewTerminal={handleNewWorkspaceTerminal}
          onToggleBottomPanel={toggleBottomPanel}
          onToggleFileTree={() => {
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
        />

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
                      <ErrorBoundary name="workspace">
                        <div className="relative h-full min-h-0">
                          {shouldRenderWorkspaceStack ? (
                            <WorkspaceStack items={workspaceStackItems} />
                          ) : null}
                          {!shouldRenderWorkspaceStack ? (
                            <div className={cn(workspaceStackItems.length > 0 ? "absolute inset-0" : "h-full")}>
                              <WorkspaceView />
                            </div>
                          ) : null}
                        </div>
                      </ErrorBoundary>
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
                      <ErrorBoundary name="file-tree">
                        {fileTreeOpen && selectedWs?.status === "ready" ? (
                          <WorkspaceFileTreePanel
                            key={selectedWs.id}
                            workspaceRoot={selectedWs.worktreePath}
                            workspaceId={selectedWs.id}
                          />
                        ) : null}
                      </ErrorBoundary>
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
                    <ErrorBoundary name="bottom-panel">
                      {bottomPanelOpen ? <BottomPanel /> : null}
                    </ErrorBoundary>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </TabDragProvider>
        </div>

        <AppStatusBar
          connectionState={connectionState}
          workspaceStatus={selectedWs?.status ?? null}
        />
      </div>
    </div>
  );
}
