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
import { useWorkspaceStore } from "@/stores/workspace-store";
import { tabKey } from "@/lib/layout/layout-tree";
import type {
  LayoutNode,
  LayoutLeaf,
  SessionState,
  SlotState,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { terminalTheme } from "@/lib/terminal/terminal-theme";
import { RotateCcw, Trash2 } from "lucide-react";
import { getTerminalDaemonClient } from "@/lib/terminal/terminal-runtime";
import { seedWorkspaceTerminal } from "@/lib/terminal/terminal-seed";

type TerminalAnchorInfo = {
  el: HTMLElement;
  workspaceId: string;
  visible: boolean;
  focused: boolean;
  onFocus?: () => void;
};

const NativeTerminalRegContext = createContext<
  ((sessionId: string, info: TerminalAnchorInfo | null) => void) | null
>(null);

function PaneTerminalAnchorSlot({
  sessionForSlot,
  isActiveTab,
  isFocused,
  workspaceId,
  leafId,
  layoutTargetOnFocus,
}: {
  sessionForSlot: SessionState;
  isActiveTab: boolean;
  isFocused: boolean;
  workspaceId: string;
  leafId: string;
  layoutTargetOnFocus: string | null;
}) {
  const registerTerminalAnchor = useContext(NativeTerminalRegContext);
  const anchorRef = useRef<HTMLDivElement>(null);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);
  const setNavigationArea = useWorkspaceStore((s) => s.setNavigationArea);
  const setLayoutTargetRuntimeId = useWorkspaceStore((s) => s.setLayoutTargetRuntimeId);

  const handleFocus = useCallback(() => {
    setLayoutTargetRuntimeId(layoutTargetOnFocus);
    setFocusedPane(leafId);
    setNavigationArea("workspace");
  }, [leafId, layoutTargetOnFocus, setFocusedPane, setLayoutTargetRuntimeId, setNavigationArea]);

  useLayoutEffect(() => {
    if (!registerTerminalAnchor) return;
    const el = anchorRef.current;
    if (!el) return;
    registerTerminalAnchor(sessionForSlot.id, {
      el,
      workspaceId,
      visible: isActiveTab,
      focused: isFocused && isActiveTab,
      onFocus: handleFocus,
    });
  }, [
    registerTerminalAnchor,
    sessionForSlot.id,
    workspaceId,
    isActiveTab,
    isFocused,
    handleFocus,
  ]);

  useLayoutEffect(() => {
    if (!registerTerminalAnchor) return;
    return () => registerTerminalAnchor(sessionForSlot.id, null);
  }, [registerTerminalAnchor, sessionForSlot.id]);

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
  const runtime = useWorkspaceStore((s) => s.runtimes[workspaceId]);
  const setFocusedPane = useWorkspaceStore((s) => s.setFocusedPane);
  const setNavigationArea = useWorkspaceStore((s) => s.setNavigationArea);
  const setLayoutTargetRuntimeId = useWorkspaceStore((s) => s.setLayoutTargetRuntimeId);

  const slotsMap = useMemo(() => {
    const map: Record<string, SlotState> = {};
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
  const activeTab = leaf.tabs[leaf.selectedIndex] ?? leaf.tabs[0];
  const activeSlotId =
    activeTab?.kind === "terminal" ? activeTab.slotId : null;
  const slot = activeSlotId ? slotsMap[activeSlotId] : null;

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
          const sessionForSlot = Object.values(sessionsMap).find(
            (s) => s.slotID === tab.slotId && s.status === "running"
          );
          if (!sessionForSlot) return null;
          return (
            <PaneTerminalAnchorSlot
              key={tabKey(tab)}
              sessionForSlot={sessionForSlot}
              isActiveTab={isActiveTab}
              isFocused={isFocused}
              workspaceId={workspaceId}
              leafId={leaf.id}
              layoutTargetOnFocus={layoutTargetOnFocus}
            />
          );
        })}

        {leaf.tabs.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center text-sm text-[var(--oc-text-subtle)]">
            <p>No open tabs</p>
            <button
              onClick={() => {
                const client = getTerminalDaemonClient();
                if (client) seedWorkspaceTerminal(client, workspaceId);
              }}
              className="mt-2 rounded-md bg-[var(--oc-panel-elevated)] px-3 py-1.5 text-sm text-[var(--oc-text)] transition-colors hover:bg-[var(--oc-panel-hover)]"
            >
              New Terminal
            </button>
            <p className="mt-1 max-w-xs text-xs text-[var(--oc-text-faint)]">
              or open a file from the file tree
            </p>
          </div>
        )}

        {!onlyEditors &&
          !anyTerminalRunning &&
          terminalSlots.length > 0 &&
          slot?.aggregateStatus !== "stopped" && (
          <div className="flex items-center justify-center h-full text-[var(--oc-text-faint)] text-sm">
            {slot ? <span>Connecting...</span> : <span>No terminal</span>}
          </div>
        )}
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
              hitAreaMargins={{ coarse: 0, fine: 0 }}
              className={cn(
                "z-20 shrink-0 border-0 p-0 outline-none transition-colors hover:bg-[var(--oc-interactive)]",
                direction === "horizontal"
                  ? "h-full min-h-0 w-[2px] min-w-[2px] max-w-[2px] cursor-col-resize bg-[var(--oc-text-faint)]"
                  : "h-[2px] min-h-[2px] max-h-[2px] w-full cursor-row-resize bg-[var(--oc-text-faint)]"
              )}
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
  runtime,
  anchors,
}: {
  runtime: WorkspaceRuntimeState;
  anchors: Record<string, TerminalAnchorInfo>;
}) {
  const runningSessions = useMemo(
    () => runtime.sessions.filter((s) => s.status === "running"),
    [runtime.sessions]
  );

  return (
    <>
      {runningSessions.map((s) => {
        const a = anchors[s.id];
        if (!a) return null;
        return (
          <TerminalSurface
            key={s.id}
            anchorElement={a.el}
            sessionID={s.id}
            surfaceId={s.id}
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
}: {
  workspaceId: string;
  workspaceRoot: string;
  runtime: WorkspaceRuntimeState;
  layoutTargetOnFocus?: string | null;
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

  return (
    <NativeTerminalRegContext.Provider value={registerTerminalAnchor}>
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
          <MemoHoistedNativeTerminals runtime={runtime} anchors={anchors} />
        </div>
      </div>
    </NativeTerminalRegContext.Provider>
  );
}

function EmptyWorkspaceState() {
  const { selectedWorkspace, selectedProject } = useWorkspaceStore();
  const workspace = selectedWorkspace();

  if (!workspace) {
    const project = selectedProject();
    if (!project) {
      return (
        <div className="flex items-center justify-center h-full text-[var(--oc-text-faint)]">
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
      <div className="flex items-center justify-center h-full text-[var(--oc-text-faint)]">
        <div className="text-center">
          <p className="text-lg font-medium">No workspace selected</p>
          <p className="text-sm mt-1">Create a workspace in the sidebar</p>
        </div>
      </div>
    );
  }

  if (workspace.status === "creating") {
    return (
      <div className="flex items-center justify-center h-full text-[var(--oc-text-subtle)]">
        <div className="text-center">
          <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[var(--oc-text-faint)] border-t-[var(--oc-interactive)]" />
          <p className="text-sm">Creating workspace...</p>
          <p className="mt-1 text-xs text-[var(--oc-text-faint)]">Setting up git worktree</p>
        </div>
      </div>
    );
  }

  if (workspace.status === "failed") {
    const { retryWorkspace, removeWorkspace } = useWorkspaceStore.getState();
    return (
      <div className="flex items-center justify-center h-full text-[var(--oc-text-subtle)]">
        <div className="text-center max-w-md">
          <p className="text-sm text-red-400">Workspace creation failed</p>
          {workspace.failureMessage && (
            <p className="mt-1 break-words text-xs text-[var(--oc-text-faint)]">
              {workspace.failureMessage}
            </p>
          )}
          <div className="flex gap-2 justify-center mt-4">
            <button
              onClick={() => void retryWorkspace(workspace.id)}
              className="flex items-center gap-1.5 rounded-md bg-[var(--oc-panel-elevated)] px-3 py-1.5 text-sm text-[var(--oc-text)] transition-colors hover:bg-[var(--oc-panel-hover)]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
            <button
              onClick={() => void removeWorkspace(workspace.id)}
              className="flex items-center gap-1.5 rounded-md bg-[var(--oc-panel-elevated)] px-3 py-1.5 text-sm text-[var(--oc-text)] transition-colors hover:bg-[var(--oc-panel-hover)]"
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
  const handleNewTerminal = useCallback(() => {
    const client = getTerminalDaemonClient();
    if (!client) return;
    seedWorkspaceTerminal(client, workspaceId);
  }, [workspaceId]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-[var(--oc-text-subtle)]">No open tabs</p>
        <button
          onClick={handleNewTerminal}
          className="mt-3 rounded-md bg-[var(--oc-panel-elevated)] px-4 py-2 text-sm text-[var(--oc-text)] transition-colors hover:bg-[var(--oc-panel-hover)]"
        >
          New Terminal
        </button>
        <p className="mt-2 text-xs text-[var(--oc-text-faint)]">
          or open a file from the file tree
        </p>
      </div>
    </div>
  );
}

function WorkspaceRuntimeLoading({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center text-[var(--oc-text-subtle)]">
      <div className="text-center">
        <div className="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-[var(--oc-text-faint)] border-t-[var(--oc-interactive)]" />
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}

export default function WorkspaceView() {
  const selectedWorkspaceID = useWorkspaceStore((s) => s.selectedWorkspaceID);
  const selectedWs = useWorkspaceStore((s) => s.selectedWorkspace());
  const runtime = useWorkspaceStore(
    (s) => (selectedWorkspaceID ? s.runtimes[selectedWorkspaceID] : null)
  );
  const setLayoutTargetRuntimeId = useWorkspaceStore((s) => s.setLayoutTargetRuntimeId);
  const setNavigationArea = useWorkspaceStore((s) => s.setNavigationArea);

  if (!selectedWs || selectedWs.status !== "ready") {
    return <EmptyWorkspaceState />;
  }

  if (!runtime) {
    return <WorkspaceRuntimeLoading message="Loading workspace…" />;
  }

  if (runtime.layoutLoading) {
    return <WorkspaceRuntimeLoading message="Starting workspace…" />;
  }

  if (!runtime.root) {
    return <EmptyWorkspaceLayout workspaceId={selectedWorkspaceID!} />;
  }

  return (
    <div
      className="h-full min-h-0"
      onPointerDownCapture={() => {
        setLayoutTargetRuntimeId(null);
        setNavigationArea("workspace");
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
