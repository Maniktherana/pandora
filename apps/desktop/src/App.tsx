import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PanelResizeHandle, ImperativePanelHandle } from "react-resizable-panels";
import LeftSidebar from "@/components/layout/left-sidebar/left-sidebar";
import BottomPanel from "@/components/layout/bottom-panel";
import RightSidebar from "@/components/layout/right-sidebar/right-sidebar";
import { TabDragProvider } from "@/components/dnd/tab-drag-provider";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import WorkspaceView from "@/components/layout/workspace/workspace-view";
import ErrorBoundary from "@/components/error-boundary";
import AppHeader from "@/components/layout/app-header";
import { useNativeTerminalOverlay } from "@/hooks/use-native-terminal-overlay";
import { cn } from "@/lib/shared/utils";
import useKeyboardShortcuts from "@/hooks/use-keyboard-shortcuts";
import { useDesktopView } from "@/hooks/use-desktop-view";
import type { LeftPanelMode } from "@/components/layout/right-sidebar/files/files.types";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { useUiPreferencesActions, useUiPreferencesView } from "@/hooks/use-ui-preferences";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { useBootstrapDesktop } from "@/hooks/use-bootstrap-desktop";

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [rightSidebarMode, setRightSidebarMode] = useState<LeftPanelMode>("files");
  const fileTreePanelRef = useRef<ImperativePanelHandle>(null);
  const bottomPanelRef = useRef<ImperativePanelHandle>(null);
  const sidebarResizeFrameRef = useRef<number | null>(null);
  const sidebarResizeWidthRef = useRef<number | null>(null);
  useBootstrapDesktop();
  useNativeTerminalOverlay(isResizingPanels ? "semi-transparent" : null);

  const selectedWs = useDesktopView((view) => view.selectedWorkspace);
  const selectedWsStatus = useDesktopView((view) => view.selectedWorkspace?.status ?? null);
  const selectedWsId = useDesktopView((view) => view.selectedWorkspaceID);
  const selectedProject = useDesktopView((view) => view.selectedProject);
  const sidebarVisible = useUiPreferencesView((view) => view.sidebarVisible);
  const sidebarHydrated = useUiPreferencesView((view) => view.sidebarHydrated);
  const fileTreeHydrated = useUiPreferencesView((view) => view.fileTreeHydrated);
  const fileTreeOpen = useUiPreferencesView((view) => view.fileTreeOpen);
  const booting = !sidebarHydrated || !fileTreeHydrated;
  const terminalCommands = useTerminalActions();
  const uiPreferencesCommands = useUiPreferencesActions();
  const workspaceCommands = useWorkspaceActions();

  const handleNewTerminalShortcut = useCallback(() => {
    terminalCommands.newTerminal();
  }, [terminalCommands]);

  const handleCloseFocusedTab = useCallback(() => {
    terminalCommands.closeFocusedTab();
  }, [terminalCommands]);

  const toggleBottomPanel = useCallback(() => {
    terminalCommands.toggleBottomPanel(bottomPanelOpen);
    setBottomPanelOpen((v) => !v);
  }, [bottomPanelOpen, terminalCommands]);

  const handleShowSidebar = useCallback(() => {
    uiPreferencesCommands.setSidebarVisible(true);
  }, [uiPreferencesCommands]);

  const handleToggleSidebar = useCallback(() => {
    uiPreferencesCommands.setSidebarVisible(!sidebarVisible);
  }, [sidebarVisible, uiPreferencesCommands]);

  const handleSelectRightSidebarMode = useCallback(
    (mode: LeftPanelMode) => {
      if (selectedWs?.status !== "ready") return;
      const shouldOpen = !fileTreeOpen || rightSidebarMode !== mode;
      setRightSidebarMode(mode);
      uiPreferencesCommands.setFileTreeOpenForWorkspace(selectedWs.id, shouldOpen);
    },
    [fileTreeOpen, rightSidebarMode, selectedWs, uiPreferencesCommands],
  );

  useKeyboardShortcuts({
    onNewTerminal: handleNewTerminalShortcut,
    onCloseTab: handleCloseFocusedTab,
    onToggleSidebar: handleToggleSidebar,
    onToggleBottomPanel: toggleBottomPanel,
  });

  useEffect(() => {
    uiPreferencesCommands.syncSelectedWorkspace(
      selectedWs?.status === "ready" ? selectedWs.id : null,
      selectedWs?.status === "ready",
    );
  }, [selectedWs?.id, selectedWs?.status, uiPreferencesCommands]);

  useLayoutEffect(() => {
    const p = fileTreePanelRef.current;
    if (!p) return;
    if (fileTreeOpen && selectedWsStatus === "ready") {
      p.expand(12);
    } else {
      p.collapse();
    }
  }, [fileTreeOpen, selectedWsStatus]);

  useLayoutEffect(() => {
    const p = bottomPanelRef.current;
    if (!p || selectedWsStatus !== "ready") return;
    if (bottomPanelOpen) {
      p.expand(28);
    } else {
      p.collapse();
    }
  }, [bottomPanelOpen, selectedWsStatus]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent">
      {sidebarVisible && (
        <div className="relative h-full shrink-0 bg-transparent" style={{ width: sidebarWidth }}>
          <LeftSidebar
            booting={booting}
            onCollapse={() => uiPreferencesCommands.setSidebarVisible(false)}
          />
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              setIsResizingPanels(true);

              const startX = event.clientX;
              const startWidth = sidebarWidth;

              const onPointerMove = (moveEvent: PointerEvent) => {
                const nextWidth = Math.min(
                  360,
                  Math.max(180, startWidth + moveEvent.clientX - startX),
                );
                sidebarResizeWidthRef.current = nextWidth;
                if (sidebarResizeFrameRef.current != null) return;
                sidebarResizeFrameRef.current = requestAnimationFrame(() => {
                  sidebarResizeFrameRef.current = null;
                  const width = sidebarResizeWidthRef.current;
                  if (width != null) {
                    setSidebarWidth(width);
                  }
                });
              };

              const onPointerUp = () => {
                window.removeEventListener("pointermove", onPointerMove);
                window.removeEventListener("pointerup", onPointerUp);
                if (sidebarResizeFrameRef.current != null) {
                  cancelAnimationFrame(sidebarResizeFrameRef.current);
                  sidebarResizeFrameRef.current = null;
                }
                const width = sidebarResizeWidthRef.current;
                if (width != null) {
                  setSidebarWidth(width);
                  sidebarResizeWidthRef.current = null;
                }
                setIsResizingPanels(false);
              };

              window.addEventListener("pointermove", onPointerMove);
              window.addEventListener("pointerup", onPointerUp);
            }}
            className="group absolute inset-y-0 right-0 z-20 w-px cursor-col-resize bg-transparent"
          >
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[var(--theme-text-subtle)] to-transparent opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          </div>
        </div>
      )}

      <div className="flex h-full min-w-0 flex-1 flex-col bg-[#151515]">
        <AppHeader
          booting={booting}
          sidebarVisible={sidebarVisible}
          selectedWorkspace={selectedWs}
          bottomPanelOpen={bottomPanelOpen}
          fileTreeOpen={fileTreeOpen}
          rightSidebarMode={rightSidebarMode}
          onToggleSidebar={handleShowSidebar}
          onToggleBottomPanel={toggleBottomPanel}
          onSelectRightSidebarMode={handleSelectRightSidebarMode}
        />

        <div className="flex-1 min-h-0 flex flex-col">
          <TabDragProvider>
            <ResizablePanelGroup direction="vertical" className="h-full min-h-0">
              <ResizablePanel defaultSize={72} minSize={35} className="min-h-0">
                <ResizablePanelGroup direction="horizontal" className="h-full min-h-0">
                  <ResizablePanel defaultSize={72} minSize={45}>
                    <div
                      className="h-full min-h-0 min-w-0"
                      data-workspace-drop-root="true"
                      data-workspace-id={selectedWsStatus === "ready" ? selectedWsId ?? undefined : undefined}
                      onPointerDownCapture={() => workspaceCommands.setLayoutTargetRuntimeId(null)}
                    >
                      <ErrorBoundary name="workspace">
                        <div className="relative h-full min-h-0">
                          <WorkspaceView />
                        </div>
                      </ErrorBoundary>
                    </div>
                  </ResizablePanel>
                  <PanelResizeHandle
                    onDragging={setIsResizingPanels}
                    className={cn(
                      "z-20 w-px min-w-px max-w-px shrink-0 bg-[var(--theme-border)] transition-colors hover:bg-[var(--theme-interactive)]",
                      fileTreeOpen && selectedWsStatus === "ready"
                        ? "cursor-col-resize"
                        : "hidden",
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
                      onPointerDownCapture={() => workspaceCommands.setLayoutTargetRuntimeId(null)}
                    >
                      <ErrorBoundary name="file-tree">
                        {fileTreeOpen && selectedWsStatus === "ready" && selectedWs ? (
                          <RightSidebar
                            key={selectedWs.id}
                            workspaceRoot={selectedWs.worktreePath}
                            workspaceId={selectedWs.id}
                            workspaceName={selectedWs.name}
                            projectDisplayName={selectedProject?.displayName ?? selectedWs.name}
                            mode={rightSidebarMode}
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
                    onDragging={setIsResizingPanels}
                    className={cn(
                      "z-20 h-px min-h-px max-h-px w-full shrink-0 bg-[var(--theme-border)] transition-colors hover:bg-[var(--theme-interactive)]",
                      bottomPanelOpen ? "cursor-row-resize" : "hidden",
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
                      {bottomPanelOpen ? (
                        <BottomPanel onCollapse={() => setBottomPanelOpen(false)} />
                      ) : null}
                    </ErrorBoundary>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </TabDragProvider>
        </div>
      </div>
    </div>
  );
}
