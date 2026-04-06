import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PanelResizeHandle, ImperativePanelHandle } from "react-resizable-panels";
import Sidebar from "@/components/navigation/sidebar";
import BottomPanel from "@/components/panels/bottom-panel";
import WorkspaceFileTreePanel from "@/components/files/workspace-file-tree-panel";
import { TabDragProvider } from "@/components/dnd/tab-drag-layer";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import WorkspaceView from "@/components/workspace/workspace-view";
import ErrorBoundary from "@/components/error-boundary";
import AppToolbar from "@/components/layout/app-toolbar";
import AppStatusBar from "@/components/layout/app-status-bar";
import { cn } from "@/lib/shared/utils";
import useKeyboardShortcuts from "@/hooks/use-keyboard-shortcuts";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { useUiPreferencesActions, useUiPreferencesView } from "@/hooks/use-ui-preferences";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { useBootstrapDesktop } from "@/hooks/use-bootstrap-desktop";

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(224);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const fileTreePanelRef = useRef<ImperativePanelHandle>(null);
  const bottomPanelRef = useRef<ImperativePanelHandle>(null);
  useBootstrapDesktop();

  const {
    selectedWorkspace: selectedWs,
    activeRuntime: runtime,
  } = useDesktopView();
  const { sidebarVisible, fileTreeOpen } = useUiPreferencesView();
  const terminalCommands = useTerminalActions();
  const uiPreferencesCommands = useUiPreferencesActions();
  const workspaceCommands = useWorkspaceActions();

  const handleNewWorkspaceTerminal = useCallback(() => {
    terminalCommands.newTerminal();
  }, [terminalCommands]);

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

  useKeyboardShortcuts({
    onNewTerminal: handleNewTerminalShortcut,
    onCloseTab: handleCloseFocusedTab,
    onToggleSidebar: handleToggleSidebar,
    onToggleBottomPanel: toggleBottomPanel,
  });

  const connectionState = runtime?.connectionState ?? "disconnected";

  useEffect(() => {
    uiPreferencesCommands.syncSelectedWorkspace(
      selectedWs?.status === "ready" ? selectedWs.id : null,
      selectedWs?.status === "ready"
    );
  }, [selectedWs?.id, selectedWs?.status, uiPreferencesCommands]);

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
          <Sidebar onCollapse={() => uiPreferencesCommands.setSidebarVisible(false)} />
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
            if (selectedWs?.status !== "ready") return;
            uiPreferencesCommands.setFileTreeOpenForWorkspace(selectedWs.id, !fileTreeOpen);
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
                      onPointerDownCapture={() => workspaceCommands.setLayoutTargetRuntimeId(null)}
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
