import {
  createContext,
  useCallback,
  useContext,
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PanelResizeHandle } from "react-resizable-panels";
import PaneTabBar from "@/components/dnd/pane-tab-bar";
import DiffViewer from "@/components/editor/diff-viewer";
import PaneEditor from "@/components/editor/pane-editor";
import TerminalSurface from "@/components/terminal/terminal-surface";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import { useDesktopView, useWorkspaceView } from "@/hooks/use-desktop-view";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { tabKey } from "@/lib/layout/layout-tree";
import type {
  LayoutNode,
  LayoutLeaf,
  SessionState,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { panelResizeHandleClasses } from "@/components/ui/panel-resize-handle-classes";
import { terminalTheme } from "@/lib/terminal/terminal-theme";
import { RotateCcw, Trash2 } from "lucide-react";

type TerminalAnchorInfo = {
  el: HTMLElement;
  workspaceId: string;
  visible: boolean;
  focused: boolean;
  onFocus?: () => void;
};

type NativeTerminalRegistration = {
  register: (sessionId: string, info: TerminalAnchorInfo | null) => void;
  workspaceVisible: boolean;
};

const NativeTerminalRegContext = createContext<NativeTerminalRegistration | null>(null);

function PaneTerminalAnchorSlot({
  sessionId,
  isActiveTab,
  isFocused,
  workspaceId,
  leafId,
  layoutTargetOnFocus,
}: {
  sessionId: string;
  isActiveTab: boolean;
  isFocused: boolean;
  workspaceId: string;
  leafId: string;
  layoutTargetOnFocus: string | null;
}) {
  const terminalRegistration = useContext(NativeTerminalRegContext);
  const anchorRef = useRef<HTMLDivElement>(null);
  const layoutCommands = useLayoutActions();
  const workspaceCommands = useWorkspaceActions();
  const layoutTargetRuntimeId = useDesktopView((view) => view.layoutTargetRuntimeId);
  const ownsNativeFocus = layoutTargetRuntimeId === layoutTargetOnFocus;

  const handleFocus = useCallback(() => {
    workspaceCommands.setLayoutTargetRuntimeId(layoutTargetOnFocus);
    layoutCommands.setFocusedPane(leafId);
    workspaceCommands.setNavigationArea("workspace");
  }, [leafId, layoutCommands, layoutTargetOnFocus, workspaceCommands]);

  useLayoutEffect(() => {
    if (!terminalRegistration) return;
    const el = anchorRef.current;
    if (!el) return;
    const workspaceVisible = terminalRegistration.workspaceVisible;
    console.debug("[terminal-surface]", "anchor register", {
      workspaceId,
      sessionId,
      visible: workspaceVisible && isActiveTab,
      focused: workspaceVisible && isFocused && isActiveTab,
    });
    terminalRegistration.register(sessionId, {
      el,
      workspaceId,
      visible: workspaceVisible && isActiveTab,
      focused: workspaceVisible && ownsNativeFocus && isFocused && isActiveTab,
      onFocus: handleFocus,
    });
  }, [
    terminalRegistration,
    sessionId,
    workspaceId,
    isActiveTab,
    isFocused,
    handleFocus,
    ownsNativeFocus,
    terminalRegistration?.workspaceVisible,
  ]);

  useLayoutEffect(() => {
    if (!terminalRegistration) return;
    return () => {
      const workspaceVisible = terminalRegistration.workspaceVisible;
      console.debug("[terminal-surface]", "anchor unregister", {
        workspaceId,
        sessionId,
        visible: workspaceVisible && isActiveTab,
        focused: workspaceVisible && isFocused && isActiveTab,
      });
      terminalRegistration.register(sessionId, null);
    };
  }, [terminalRegistration, sessionId, workspaceId, isActiveTab, isFocused]);

  return (
    <div
      ref={anchorRef}
      className="absolute inset-0"
      style={{
        visibility: isActiveTab ? "visible" : "hidden",
        pointerEvents: isActiveTab ? "auto" : "none",
      }}
      aria-hidden={!isActiveTab}
    />
  );
}

interface PaneViewProps {
  leaf: LayoutLeaf;
  isFocused: boolean;
  workspaceId: string;
  workspaceRoot: string;
  layoutTargetOnFocus: string | null;
  hideTabBar?: boolean;
  isResizing?: boolean;
}

function PaneView({
  leaf,
  isFocused,
  workspaceId,
  workspaceRoot,
  layoutTargetOnFocus,
  hideTabBar = false,
  isResizing,
}: PaneViewProps) {
  const runtime = useWorkspaceView(workspaceId, (view) => view.runtime);
  const layoutCommands = useLayoutActions();
  const terminalCommands = useTerminalActions();
  const workspaceCommands = useWorkspaceActions();

  const slotsMap = useMemo(() => {
    const map: Record<string, { id: string; sessionIDs: string[] }> = {};
    for (const slot of runtime?.slots ?? []) {
      map[slot.id] = slot;
    }
    return map;
  }, [runtime?.slots]);

  const sessionsMap = useMemo(() => {
    const map: Record<string, SessionState> = {};
    for (const session of runtime?.sessions ?? []) {
      map[session.id] = session;
    }
    return map;
  }, [runtime?.sessions]);

  const terminalSlots = leaf.tabs
    .map((t, i) => (t.kind === "terminal" ? { slotId: t.slotId, idx: i } : null))
    .filter((x): x is { slotId: string; idx: number } => x !== null);

  const anyTerminalRunning = terminalSlots.some(({ slotId }) =>
    Object.values(sessionsMap).some((s) => s.slotID === slotId && s.status === "running")
  );

  const onlyEditors =
    leaf.tabs.length > 0 &&
    leaf.tabs.every((t) => t.kind === "editor" || t.kind === "diff");

  return (
    <div
      data-pane-id={leaf.id}
      data-workspace-id={workspaceId}
      className="flex flex-col h-full overflow-hidden rounded-sm relative"
    >
      {!hideTabBar && (
        <PaneTabBar
          paneID={leaf.id}
          tabs={leaf.tabs}
          selectedIndex={leaf.selectedIndex}
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          isFocused={isFocused}
        />
      )}

      <div
        className="flex-1 min-h-0 relative"
        style={{
          background: terminalTheme.background ?? "#0a0a0a",
          pointerEvents: isResizing ? "none" : undefined,
        }}
        onPointerDownCapture={() => {
          workspaceCommands.setLayoutTargetRuntimeId(layoutTargetOnFocus);
          workspaceCommands.setNavigationArea("workspace");
          layoutCommands.setFocusedPane(leaf.id);
        }}
      >
        {leaf.tabs.map((tab, idx) => {
          const isActiveTab = idx === leaf.selectedIndex;
          if (tab.kind === "editor") {
            return (
              <PaneEditor
                key={tabKey(tab)}
                workspaceId={workspaceId}
                workspaceRoot={workspaceRoot}
                relativePath={tab.path}
                isActive={isActiveTab}
              />
            );
          }
          if (tab.kind === "diff") {
            return (
              <div
                key={tabKey(tab)}
                className="absolute inset-0 overflow-hidden"
                style={{
                  visibility: isActiveTab ? "visible" : "hidden",
                  pointerEvents: isActiveTab ? "auto" : "none",
                }}
                aria-hidden={!isActiveTab}
              >
                <DiffViewer
                  workspaceRoot={workspaceRoot}
                  relativePath={tab.path}
                  source={tab.source}
                  isActive={isActiveTab}
                />
              </div>
            );
          }
          const slot = slotsMap[tab.slotId];
          const sessionForSlot =
            Object.values(sessionsMap).find((s) => s.slotID === tab.slotId && s.status === "running") ??
            (slot?.sessionIDs[0] ? sessionsMap[slot.sessionIDs[0]] : undefined);
          const sessionId = sessionForSlot?.id ?? slot?.sessionIDs[0] ?? null;
          if (!sessionId) return null;
          return (
            <PaneTerminalAnchorSlot
              key={tabKey(tab)}
              sessionId={sessionId}
              isActiveTab={isActiveTab}
              isFocused={isFocused}
              workspaceId={workspaceId}
              leafId={leaf.id}
              layoutTargetOnFocus={layoutTargetOnFocus}
            />
          );
        })}

        {leaf.tabs.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center text-sm text-[var(--theme-text-subtle)]">
            <p>No open tabs</p>
            <button
              onClick={() => {
                terminalCommands.createWorkspaceTerminal(workspaceId);
              }}
              className="mt-2 rounded-md bg-[var(--theme-panel-elevated)] px-3 py-1.5 text-sm text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-panel-hover)]"
            >
              New Terminal
            </button>
            <p className="mt-1 max-w-xs text-xs text-[var(--theme-text-faint)]">
              or open a file from the file tree
            </p>
          </div>
        )}

        {!onlyEditors && !anyTerminalRunning && terminalSlots.length > 0 && null}
      </div>
    </div>
  );
}

const MemoPaneView = memo(PaneView);

interface LayoutRendererProps {
  node: LayoutNode;
  focusedPaneID: string | null;
  workspaceId: string;
  workspaceRoot: string;
  layoutTargetOnFocus: string | null;
  hideTabBar?: boolean;
  isResizing?: boolean;
}

function LayoutRenderer({
  node,
  focusedPaneID,
  workspaceId,
  workspaceRoot,
  layoutTargetOnFocus,
  hideTabBar = false,
  isResizing,
}: LayoutRendererProps) {
  const [localResizing, setLocalResizing] = useState(false);
  const anyResizing = isResizing || localResizing;

  if (node.type === "leaf") {
    return (
      <MemoPaneView
        leaf={node}
        isFocused={node.id === focusedPaneID}
        workspaceId={workspaceId}
        workspaceRoot={workspaceRoot}
        layoutTargetOnFocus={layoutTargetOnFocus}
        hideTabBar={hideTabBar}
        isResizing={anyResizing}
      />
    );
  }

  const direction = node.axis === "horizontal" ? "horizontal" : "vertical";

  return (
    <ResizablePanelGroup direction={direction}>
      {node.children.map((child, i) => (
        <div key={child.id} className="contents">
          {i > 0 && (
            <PanelResizeHandle
              className={panelResizeHandleClasses(direction === "horizontal" ? "horizontal" : "vertical")}
              hitAreaMargins={{ coarse: 10, fine: 8 }}
              onDragging={setLocalResizing}
            />
          )}
          <ResizablePanel defaultSize={node.ratios[i] * 100} minSize={10}>
            <MemoLayoutRenderer
              node={child}
              focusedPaneID={focusedPaneID}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              layoutTargetOnFocus={layoutTargetOnFocus}
              isResizing={anyResizing}
            />
          </ResizablePanel>
        </div>
      ))}
    </ResizablePanelGroup>
  );
}

const MemoLayoutRenderer = memo(LayoutRenderer);

function HoistedNativeTerminals({
  anchors,
}: {
  anchors: Record<string, TerminalAnchorInfo>;
}) {
  const sessionIds = useMemo(() => Object.keys(anchors), [anchors]);

  return (
    <>
      {sessionIds.map((sessionId) => {
        const a = anchors[sessionId];
        if (!a) return null;
        return (
          <TerminalSurface
            key={sessionId}
            anchorElement={a.el}
            sessionID={sessionId}
            surfaceId={sessionId}
            workspaceId={a.workspaceId}
            visible={a.visible}
            focused={a.focused}
            onFocus={a.onFocus}
          />
        );
      })}
    </>
  );
}

const MemoHoistedNativeTerminals = memo(HoistedNativeTerminals);

export function WorkspaceRuntimeView({
  workspaceId,
  workspaceRoot,
  runtime,
  layoutTargetOnFocus = null,
  isVisible = true,
}: {
  workspaceId: string;
  workspaceRoot: string;
  runtime: WorkspaceRuntimeState;
  layoutTargetOnFocus?: string | null;
  isVisible?: boolean;
}) {
  const [anchors, setAnchors] = useState<Record<string, TerminalAnchorInfo>>({});

  const registerTerminalAnchor = useCallback((sessionId: string, info: TerminalAnchorInfo | null) => {
    setAnchors((prev) => {
      if (info === null) {
        if (!(sessionId in prev)) return prev;
        const next = { ...prev };
        delete next[sessionId];
        return next;
      }
      const p = prev[sessionId];
      if (
        p &&
        p.el === info.el &&
        p.visible === info.visible &&
        p.focused === info.focused &&
        p.workspaceId === info.workspaceId &&
        p.onFocus === info.onFocus
      ) {
        return prev;
      }
      return { ...prev, [sessionId]: info };
    });
  }, []);

  const terminalRegistration = useMemo<NativeTerminalRegistration>(
    () => ({
      register: registerTerminalAnchor,
      workspaceVisible: isVisible,
    }),
    [registerTerminalAnchor, isVisible]
  );

  return (
    <NativeTerminalRegContext.Provider value={terminalRegistration}>
      <div className="relative h-full w-full min-h-0">
        <div className="relative h-full min-h-0 min-w-0">
          <MemoLayoutRenderer
            node={runtime.root!}
            focusedPaneID={runtime.focusedPaneID}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            layoutTargetOnFocus={layoutTargetOnFocus}
            hideTabBar={false}
          />
          <MemoHoistedNativeTerminals anchors={anchors} />
        </div>
      </div>
    </NativeTerminalRegContext.Provider>
  );
}

function EmptyWorkspaceState() {
  const workspace = useDesktopView((view) => view.selectedWorkspace);
  const project = useDesktopView((view) => view.selectedProject);
  const workspaceCommands = useWorkspaceActions();

  if (!workspace) {
    if (!project) {
      return (
        <div className="flex items-center justify-center h-full text-[var(--theme-text-faint)]">
          <div className="text-center">
            <p className="text-lg font-medium">No project selected</p>
            <p className="text-sm mt-1">
              Add a project from the sidebar to get started
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-full text-[var(--theme-text-faint)]">
        <div className="text-center">
          <p className="text-lg font-medium">No workspace selected</p>
          <p className="text-sm mt-1">Create a workspace in the sidebar</p>
        </div>
      </div>
    );
  }

  if (workspace.status === "creating") {
    return (
      <div className="flex items-center justify-center h-full text-[var(--theme-text-subtle)]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[var(--theme-text-faint)] border-t-[var(--theme-interactive)]" />
          <p className="text-sm">Creating workspace...</p>
          <p className="mt-1 text-xs text-[var(--theme-text-faint)]">Setting up git worktree</p>
        </div>
      </div>
    );
  }

  if (workspace.status === "failed") {
    return (
      <div className="flex items-center justify-center h-full text-[var(--theme-text-subtle)]">
        <div className="text-center max-w-md">
          <p className="text-sm text-red-400">Workspace creation failed</p>
          {workspace.failureMessage && (
            <p className="mt-1 break-words text-xs text-[var(--theme-text-faint)]">
              {workspace.failureMessage}
            </p>
          )}
          <div className="flex gap-2 justify-center mt-4">
            <button
              onClick={() => workspaceCommands.retryWorkspace(workspace.id)}
              className="flex items-center gap-1.5 rounded-md bg-[var(--theme-panel-elevated)] px-3 py-1.5 text-sm text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-panel-hover)]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
            <button
              onClick={() => workspaceCommands.removeWorkspace(workspace.id)}
              className="flex items-center gap-1.5 rounded-md bg-[var(--theme-panel-elevated)] px-3 py-1.5 text-sm text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-panel-hover)]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function EmptyWorkspaceLayout({ workspaceId }: { workspaceId: string }) {
  const terminalCommands = useTerminalActions();
  const handleNewTerminal = useCallback(() => {
    terminalCommands.createWorkspaceTerminal(workspaceId);
  }, [terminalCommands, workspaceId]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-[var(--theme-text-subtle)]">No open tabs</p>
        <button
          onClick={handleNewTerminal}
          className="mt-3 rounded-md bg-[var(--theme-panel-elevated)] px-4 py-2 text-sm text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-panel-hover)]"
        >
          New Terminal
        </button>
        <p className="mt-2 text-xs text-[var(--theme-text-faint)]">
          or open a file from the file tree
        </p>
      </div>
    </div>
  );
}

function WorkspaceRuntimeLoading({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-[var(--theme-text-subtle)]">
      <div className="text-center">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[var(--theme-text-faint)] border-t-[var(--theme-interactive)]" />
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}

export default function WorkspaceView() {
  const selectedWorkspaceID = useDesktopView((view) => view.selectedWorkspaceID);
  const selectedWs = useDesktopView((view) => view.selectedWorkspace);
  const runtime = useDesktopView((view) =>
    view.selectedWorkspaceID ? view.runtimes[view.selectedWorkspaceID] ?? null : null
  );
  const workspaceCommands = useWorkspaceActions();

  if (!selectedWs || selectedWs.status !== "ready") {
    return <EmptyWorkspaceState />;
  }

  if (!runtime) {
    return <WorkspaceRuntimeLoading message="Loading workspace…" />;
  }

  if (!runtime.root) {
    if (runtime.layoutLoading) {
      return <WorkspaceRuntimeLoading message="Starting workspace…" />;
    }
    return <EmptyWorkspaceLayout workspaceId={selectedWorkspaceID!} />;
  }

  return (
    <div
      className="h-full min-h-0"
      onPointerDownCapture={() => {
        workspaceCommands.setLayoutTargetRuntimeId(null);
        workspaceCommands.setNavigationArea("workspace");
      }}
    >
      <WorkspaceRuntimeView
        workspaceId={selectedWorkspaceID!}
        workspaceRoot={selectedWs.worktreePath}
        runtime={runtime}
        layoutTargetOnFocus={null}
      />
    </div>
  );
}
