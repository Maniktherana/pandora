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
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [isResizingPanels, setIsResizingPanels] = useState(false);
  const [rightSidebarMode, setRightSidebarMode] = useState<LeftPanelMode>("files");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileTreePanelRef = useRef<ImperativePanelHandle>(null);
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

  const resolveFileTreePanelPercent = useCallback(() => {
    const measured = workspaceFileTreeSplitRef.current?.getBoundingClientRect().width ?? 0;
    const groupWidth =
      measured > 0
        ? measured
        : Math.max(
            1,
            (typeof window !== "undefined" ? window.innerWidth : 1200) -
              (sidebarVisible ? sidebarWidth : 0),
          );
    const pct = (sidebarWidth / groupWidth) * 100;
    return Math.min(55, Math.max(12, pct));
  }, [sidebarWidth, sidebarVisible]);
  const hasReadyWorkspace = selectedWsStatus === "ready";
  const fileTreePanelVisible = fileTreeOpen && hasReadyWorkspace;
  const bottomPanelVisible = bottomPanelOpen && hasReadyWorkspace;
  const fileTreePanelDefaultSize = fileTreePanelVisible ? resolveFileTreePanelPercent() : 0;
  const workspacePanelDefaultSize = 100 - fileTreePanelDefaultSize;
  const bottomPanelDefaultSize = bottomPanelVisible ? 28 : 0;
  const workspaceViewDefaultSize = 100 - bottomPanelDefaultSize;

  useLayoutEffect(() => {
    const p = fileTreePanelRef.current;
    if (!p) return;
    if (fileTreeOpen && selectedWsStatus === "ready") {
      // expand(minSize) restores from collapsed; 12 was forcing a tiny strip. Match left sidebar width in %.
      p.expand(resolveFileTreePanelPercent());
    } else {
      p.collapse();
    }
  }, [fileTreeOpen, selectedWsStatus, resolveFileTreePanelPercent]);

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
            <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-[var(--theme-text-subtle)] to-transparent opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
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
                <div ref={workspaceFileTreeSplitRef} className="h-full min-h-0 min-w-0 w-full">
                  <ResizablePanelGroup direction="horizontal" className="h-full min-h-0">
                    <ResizablePanel
                      id="workspace-main"
                      order={1}
                      defaultSize={workspacePanelDefaultSize}
                      minSize={45}
                      className="min-h-0 min-w-0"
                    >
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
                    </ResizablePanel>
                    <TerminalResizeHandle
                      direction="horizontal"
                      onDragging={setIsResizingPanels}
                      className={fileTreeOpen && selectedWsStatus === "ready" ? "z-20" : "hidden"}
                    />
                    <ResizablePanel
                      id="file-tree"
                      order={2}
                      ref={fileTreePanelRef}
                      collapsible
                      collapsedSize={0}
                      defaultSize={fileTreePanelDefaultSize}
                      minSize={12}
                      maxSize={55}
                      className="min-h-0 min-w-0"
                    >
                      <div
                        className="h-full min-h-0 min-w-0"
                        onPointerDownCapture={() =>
                          workspaceCommands.setLayoutTargetRuntimeId(null)
                        }
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
                </div>
              </TabDragProvider>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
