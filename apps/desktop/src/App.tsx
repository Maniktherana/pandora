import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImperativePanelHandle } from "react-resizable-panels";
import LeftSidebar from "@/components/layout/left-sidebar/left-sidebar";
import BottomPanel from "@/components/layout/bottom-panel";
import RightSidebar from "@/components/layout/right-sidebar/right-sidebar";
import { TabDragProvider } from "@/components/dnd/tab-drag-provider";
import TerminalResizeHandle from "@/components/terminal/terminal-resize-handle";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import WorkspaceView from "@/components/layout/workspace/workspace-view";
import ErrorBoundary from "@/components/error-boundary";
import AppHeader from "@/components/layout/app-header";
import SettingsPanel from "@/components/settings/settings-panel";
import { useNativeTerminalOcclusion } from "@/hooks/use-native-terminal-occlusion";
import { useNativeTerminalOverlay } from "@/hooks/use-native-terminal-overlay";
import useKeyboardShortcuts from "@/hooks/use-keyboard-shortcuts";
import { useDesktopView } from "@/hooks/use-desktop-view";
import type { LeftPanelMode } from "@/components/layout/right-sidebar/files/files.types";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { useUiPreferencesActions, useUiPreferencesView } from "@/hooks/use-ui-preferences";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { useBootstrapDesktop, useDesktopRuntime } from "@/hooks/use-bootstrap-desktop";
import {
  useSettingsStore,
  getFontFamily,
  getMonoFont,
  getTerminalFont,
} from "@/state/settings-store";
import { registerPandoraMonacoTheme } from "@/components/editor/monaco-pandora";
import { applyTheme, defaultTheme, themes } from "@/lib/theme";
import { loader } from "@monaco-editor/react";
import { Effect } from "effect";
import { TerminalSurfaceService } from "@/services/terminal/terminal-surface-service";

export default function App() {
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(300);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [rightSidebarMode, setRightSidebarMode] = useState<LeftPanelMode>("files");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const bottomPanelRef = useRef<ImperativePanelHandle>(null);
  const workspaceFileTreeSplitRef = useRef<HTMLDivElement>(null);
  const sidebarResizeHandleRef = useRef<HTMLDivElement>(null);
  const sidebarResizeFrameRef = useRef<number | null>(null);
  const sidebarResizeWidthRef = useRef<number | null>(null);
  const [sidebarResizeHovered, setSidebarResizeHovered] = useState(false);
  const [sidebarResizeDragging, setSidebarResizeDragging] = useState(false);
  const setSidebarResizeOcclusionElement = useNativeTerminalOcclusion(
    sidebarResizeHovered || sidebarResizeDragging,
    4,
    { exitHoldMs: 0 },
  );
  const rightSidebarResizeHandleRef = useRef<HTMLDivElement>(null);
  const rightSidebarResizeFrameRef = useRef<number | null>(null);
  const rightSidebarResizeWidthRef = useRef<number | null>(null);
  const [rightSidebarResizeHovered, setRightSidebarResizeHovered] = useState(false);
  const [rightSidebarResizeDragging, setRightSidebarResizeDragging] = useState(false);
  const setRightSidebarResizeOcclusionElement = useNativeTerminalOcclusion(
    rightSidebarResizeHovered || rightSidebarResizeDragging,
    4,
    { exitHoldMs: 0 },
  );
  const selectedThemeId = useSettingsStore((state) => state.selectedThemeId);
  const uiFontFamily = useSettingsStore((state) => state.uiFontFamily);
  const uiFontCustom = useSettingsStore((state) => state.uiFontCustom);
  const monoFontFamily = useSettingsStore((state) => state.monoFontFamily);
  const monoFontCustom = useSettingsStore((state) => state.monoFontCustom);
  const terminalFontFamily = useSettingsStore((state) => state.terminalFontFamily);
  const terminalFontCustom = useSettingsStore((state) => state.terminalFontCustom);
  const editorFontSize = useSettingsStore((state) => state.editorFontSize);
  const terminalFontSize = useSettingsStore((state) => state.terminalFontSize);
  const runtime = useDesktopRuntime();
  const terminalFontSizeHydratedRef = useRef(false);
  useBootstrapDesktop();
  useNativeTerminalOverlay(settingsOpen ? "opaque" : isResizingPanels ? "semi-transparent" : null);

  // Document CSS theme + Monaco editor theme when the workspace theme changes
  useEffect(() => {
    const workspaceTheme = themes.find((t) => t.id === selectedThemeId) ?? defaultTheme;
    applyTheme(workspaceTheme);
    void loader.init().then((monaco) => {
      registerPandoraMonacoTheme(monaco, workspaceTheme);
    });
  }, [selectedThemeId]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--theme-font-sans",
      getFontFamily(uiFontFamily, uiFontCustom),
    );
    document.documentElement.style.setProperty(
      "--theme-font-mono",
      getMonoFont(monoFontFamily, monoFontCustom),
    );
    document.documentElement.style.setProperty(
      "--theme-font-terminal",
      getTerminalFont(terminalFontFamily, terminalFontCustom),
    );
    document.documentElement.style.setProperty("--theme-font-editor-size", `${editorFontSize}px`);
    document.documentElement.style.setProperty(
      "--theme-font-terminal-size",
      `${terminalFontSize}px`,
    );
  }, [
    editorFontSize,
    monoFontFamily,
    monoFontCustom,
    terminalFontCustom,
    terminalFontFamily,
    terminalFontSize,
    uiFontCustom,
    uiFontFamily,
  ]);

  useEffect(() => {
    if (!terminalFontSizeHydratedRef.current) {
      terminalFontSizeHydratedRef.current = true;
      return;
    }

    void runtime.runPromise(
      Effect.flatMap(TerminalSurfaceService, (service) =>
        service.setAllSurfaceFontSizes(terminalFontSize),
      ).pipe(Effect.catchAll(() => Effect.void)),
    );
  }, [runtime, terminalFontSize]);

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

  const handleOpenSettings = useCallback(() => {
    workspaceCommands.setLayoutTargetRuntimeId(null);
    setSettingsOpen(true);
  }, [workspaceCommands]);

  const handleCloseSettings = useCallback(() => {
    workspaceCommands.setLayoutTargetRuntimeId(null);
    setSettingsOpen(false);
  }, [workspaceCommands]);

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
    onOpenSettings: handleOpenSettings,
  });

  useEffect(() => {
    uiPreferencesCommands.syncSelectedWorkspace(
      selectedWs?.status === "ready" ? selectedWs.id : null,
      selectedWs?.status === "ready",
    );
  }, [selectedWs?.id, selectedWs?.status, uiPreferencesCommands]);

  const hasReadyWorkspace = selectedWsStatus === "ready";
  const bottomPanelVisible = bottomPanelOpen && hasReadyWorkspace;
  const bottomPanelDefaultSize = bottomPanelVisible ? 28 : 0;
  const workspaceViewDefaultSize = 100 - bottomPanelDefaultSize;
  const fileTreePanelVisible = fileTreeOpen && hasReadyWorkspace;

  useLayoutEffect(() => {
    const p = bottomPanelRef.current;
    if (!p || selectedWsStatus !== "ready") return;
    if (bottomPanelOpen) {
      p.expand(28);
    } else {
      p.collapse();
    }
  }, [bottomPanelOpen, selectedWsStatus]);

  useEffect(() => {
    setSidebarResizeOcclusionElement(sidebarResizeHandleRef.current);
  }, [setSidebarResizeOcclusionElement]);

  useEffect(() => {
    setRightSidebarResizeOcclusionElement(rightSidebarResizeHandleRef.current);
  }, [setRightSidebarResizeOcclusionElement]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-transparent">
      {sidebarVisible && !settingsOpen && (
        <div className="relative h-full shrink-0 bg-transparent" style={{ width: sidebarWidth }}>
          <LeftSidebar
            booting={booting}
            onCollapse={() => uiPreferencesCommands.setSidebarVisible(false)}
            onOpenSettings={handleOpenSettings}
          />
          <div
            ref={sidebarResizeHandleRef}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            onPointerEnter={() => setSidebarResizeHovered(true)}
            onPointerLeave={() => setSidebarResizeHovered(false)}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              setIsResizingPanels(true);
              setSidebarResizeDragging(true);

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
                setSidebarResizeDragging(false);
              };

              window.addEventListener("pointermove", onPointerMove);
              window.addEventListener("pointerup", onPointerUp);
            }}
            className="group absolute inset-y-0 -right-1.5 z-20 w-3 cursor-col-resize bg-transparent"
          >
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--theme-text-subtle)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
          </div>
        </div>
      )}

      <div
        className={`flex h-full min-w-0 flex-1 flex-col ${settingsOpen ? "bg-transparent" : "bg-[var(--theme-bg)]"}`}
      >
        {settingsOpen ? (
          <ErrorBoundary name="settings">
            <SettingsPanel
              onClose={handleCloseSettings}
              sidebarWidth={sidebarWidth}
              activeWorkspaceId={selectedWsId ?? null}
              activeWorkspacePath={selectedWs?.status === "ready" ? selectedWs.worktreePath : null}
            />
          </ErrorBoundary>
        ) : (
          <>
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
                <div ref={workspaceFileTreeSplitRef} className="flex h-full min-h-0 min-w-0 w-full">
                  <div className="flex-1 min-w-0 min-h-0">
                    <ResizablePanelGroup direction="vertical" className="h-full min-h-0">
                      <ResizablePanel
                        id="workspace-view"
                        order={1}
                        defaultSize={workspaceViewDefaultSize}
                        minSize={35}
                        className="min-h-0"
                      >
                        <div
                          className="h-full min-h-0 min-w-0"
                          data-workspace-drop-root="true"
                          data-workspace-id={
                            selectedWsStatus === "ready" ? (selectedWsId ?? undefined) : undefined
                          }
                          onPointerDownCapture={() =>
                            workspaceCommands.setLayoutTargetRuntimeId(null)
                          }
                        >
                          <ErrorBoundary name="workspace">
                            <div className="relative h-full min-h-0">
                              <WorkspaceView />
                            </div>
                          </ErrorBoundary>
                        </div>
                      </ResizablePanel>
                      {selectedWs?.status === "ready" && (
                        <>
                          <TerminalResizeHandle
                            direction="vertical"
                            onDragging={setIsResizingPanels}
                            className={bottomPanelOpen ? "z-20" : "hidden"}
                          />
                          <ResizablePanel
                            id="bottom-terminal"
                            order={2}
                            ref={bottomPanelRef}
                            collapsible
                            collapsedSize={0}
                            defaultSize={bottomPanelDefaultSize}
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
                  </div>

                  {fileTreePanelVisible && selectedWs && (
                    <div
                      className="relative h-full shrink-0"
                      style={{ width: rightSidebarWidth }}
                      onPointerDownCapture={() =>
                        workspaceCommands.setLayoutTargetRuntimeId(null)
                      }
                    >
                      <div
                        ref={rightSidebarResizeHandleRef}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize file tree"
                        onPointerEnter={() => setRightSidebarResizeHovered(true)}
                        onPointerLeave={() => setRightSidebarResizeHovered(false)}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          event.preventDefault();
                          setIsResizingPanels(true);
                          setRightSidebarResizeDragging(true);

                          const startX = event.clientX;
                          const startWidth = rightSidebarWidth;

                          const onPointerMove = (moveEvent: PointerEvent) => {
                            const maxWidth = Math.floor(window.innerWidth * 0.4);
                            const nextWidth = Math.min(
                              maxWidth,
                              Math.max(180, startWidth - (moveEvent.clientX - startX)),
                            );
                            rightSidebarResizeWidthRef.current = nextWidth;
                            if (rightSidebarResizeFrameRef.current != null) return;
                            rightSidebarResizeFrameRef.current = requestAnimationFrame(() => {
                              rightSidebarResizeFrameRef.current = null;
                              const width = rightSidebarResizeWidthRef.current;
                              if (width != null) {
                                setRightSidebarWidth(width);
                              }
                            });
                          };

                          const onPointerUp = () => {
                            window.removeEventListener("pointermove", onPointerMove);
                            window.removeEventListener("pointerup", onPointerUp);
                            if (rightSidebarResizeFrameRef.current != null) {
                              cancelAnimationFrame(rightSidebarResizeFrameRef.current);
                              rightSidebarResizeFrameRef.current = null;
                            }
                            const width = rightSidebarResizeWidthRef.current;
                            if (width != null) {
                              setRightSidebarWidth(width);
                              rightSidebarResizeWidthRef.current = null;
                            }
                            setIsResizingPanels(false);
                            setRightSidebarResizeDragging(false);
                          };

                          window.addEventListener("pointermove", onPointerMove);
                          window.addEventListener("pointerup", onPointerUp);
                        }}
                        className="group absolute inset-y-0 -left-1.5 z-20 w-3 cursor-col-resize bg-transparent"
                      >
                        <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[var(--theme-text-subtle)] opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
                      </div>
                      <ErrorBoundary name="file-tree">
                        <RightSidebar
                          workspaceRoot={selectedWs.worktreePath}
                          workspaceId={selectedWs.id}
                          workspaceName={selectedWs.name}
                          projectDisplayName={selectedProject?.displayName ?? selectedWs.name}
                          mode={rightSidebarMode}
                        />
                      </ErrorBoundary>
                    </div>
                  )}
                </div>
              </TabDragProvider>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
