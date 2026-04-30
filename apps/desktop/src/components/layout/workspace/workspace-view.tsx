import {
  createContext,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import WorkspaceTabBar from "@/components/layout/workspace/workspace-tab-bar";
import DiffViewer from "@/components/editor/diff-viewer";
import ReviewViewer from "@/components/editor/review-viewer";
import { editorReadWorkingCopyText } from "@/services/editor/editor-service";
import PaneEditor from "@/components/editor/pane-editor";
import TerminalSurface from "@/components/terminal/terminal-surface";
import TerminalResizeHandle from "@/components/terminal/terminal-resize-handle";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import { useLazyTerminalSlotConnections } from "@/hooks/use-lazy-terminal-slot-connections";
import { useNativeTerminalOverlay } from "@/hooks/use-native-terminal-overlay";
import {
  useLayoutTargetScopeId,
  useSelectedWorkspace,
  useSelectedProject,
  useSelectedWorkspaceId,
} from "@/hooks/use-navigation";
import { useUiPreferences } from "@/hooks/use-ui-preferences";
import { useTerminalScopeStore } from "@/services/terminal/terminal-scope-store";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import { useLayoutStore } from "@/services/workspace/layout-store";
import { tabKey } from "@/components/layout/workspace/layout-tree";
import { getVisibleWorkspaceTerminalSlotIds } from "@/lib/terminal/lazy-terminal-connections";
import type { SessionState, SlotState } from "@/lib/shared/types";
import { RotateCcw, Trash2 } from "lucide-react";
import DotGridLoader from "@/components/dot-grid-loader";
import WelcomeScreen from "@/components/layout/workspace/welcome-screen";
import type { NativeTerminalRegistration, TerminalAnchorInfo } from "./workspace-view.types";

const NativeTerminalRegContext = createContext<NativeTerminalRegistration | null>(null);
const EMPTY_SLOTS: readonly SlotState[] = [];

type PaneTerminalAnchorSlotProps = {
  sessionId: string;
  isActiveTab: boolean;
  isFocused: boolean;
  workspaceId: string;
  leafId: string;
  layoutTargetOnFocus: string | null;
};

type PaneViewProps = {
  leaf: import("@/lib/shared/types").LayoutLeaf;
  isFocused: boolean;
  connectedSlotIds: ReadonlySet<string>;
  workspaceId: string;
  workspaceRoot: string;
  layoutTargetOnFocus: string | null;
  hideTabBar?: boolean;
  isResizing?: boolean;
};

function PaneTerminalAnchorSlot({
  sessionId,
  isActiveTab,
  isFocused,
  workspaceId,
  leafId,
  layoutTargetOnFocus,
}: PaneTerminalAnchorSlotProps) {
  const terminalRegistration = useContext(NativeTerminalRegContext);
  const anchorRef = useRef<HTMLDivElement>(null);
  const layoutCommands = useLayoutActions();
  const workspaceCommands = useWorkspaceActions();
  const layoutTargetScopeId = useLayoutTargetScopeId();
  const ownsNativeFocus = layoutTargetScopeId === layoutTargetOnFocus;

  const handleFocus = useCallback(() => {
    workspaceCommands.setLayoutTargetScopeId(layoutTargetOnFocus);
    layoutCommands.setFocusedPane(leafId);
    workspaceCommands.setNavigationArea("workspace");
  }, [leafId, layoutCommands, layoutTargetOnFocus, workspaceCommands]);

  useLayoutEffect(() => {
    if (!terminalRegistration) return;
    const el = anchorRef.current;
    if (!el) return;
    const workspaceVisible = terminalRegistration.workspaceVisible;
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

  // Unregister only on real unmount or identity change — not when tab/focus toggles (those update via the effect above).
  useLayoutEffect(() => {
    if (!terminalRegistration) return;
    return () => {
      terminalRegistration.register(sessionId, null);
    };
  }, [terminalRegistration, sessionId, workspaceId]);

  return (
    <div
      ref={anchorRef}
      className="absolute inset-0"
      style={{ pointerEvents: isActiveTab ? "auto" : "none" }}
    />
  );
}

function PaneView({
  leaf,
  isFocused,
  connectedSlotIds,
  workspaceId,
  workspaceRoot,
  layoutTargetOnFocus,
  hideTabBar = false,
  isResizing,
}: PaneViewProps) {
  const scope = useTerminalScopeStore((s) => s.byScopeId[workspaceId] ?? null);
  const layoutCommands = useLayoutActions();
  const terminalCommands = useTerminalActions();
  const workspaceCommands = useWorkspaceActions();

  const slotsMap = useMemo(() => {
    const map: Record<string, { id: string; sessionIDs: string[] }> = {};
    for (const slot of scope?.slots ?? []) {
      map[slot.id] = slot;
    }
    return map;
  }, [scope?.slots]);

  const sessionsMap = useMemo(() => {
    const map: Record<string, SessionState> = {};
    for (const session of scope?.sessions ?? []) {
      map[session.id] = session;
    }
    return map;
  }, [scope?.sessions]);

  const terminalSlots = leaf.tabs
    .map((t, i) => (t.kind === "terminal" ? { slotId: t.slotId, idx: i } : null))
    .filter((x): x is { slotId: string; idx: number } => x !== null);

  const terminalSlotHasRenderableSession = (slotId: string) => {
    const slot = slotsMap[slotId];
    const sessionForSlot =
      Object.values(sessionsMap).find((s) => s.slotID === slotId && s.status === "running") ??
      (slot?.sessionIDs[0] ? sessionsMap[slot.sessionIDs[0]] : undefined);
    const sessionId = sessionForSlot?.id ?? slot?.sessionIDs[0] ?? null;
    return sessionId != null;
  };

  const anyTerminalRenderable = terminalSlots.some(({ slotId }) =>
    terminalSlotHasRenderableSession(slotId),
  );

  const onlyEditors =
    leaf.tabs.length > 0 &&
    leaf.tabs.every((t) => t.kind === "editor" || t.kind === "diff" || t.kind === "review");

  const handlePanePointerDownCapture = useCallback(() => {
    workspaceCommands.setLayoutTargetScopeId(layoutTargetOnFocus);
    workspaceCommands.setNavigationArea("workspace");
    layoutCommands.setFocusedPane(leaf.id);
  }, [layoutCommands, layoutTargetOnFocus, leaf.id, workspaceCommands]);

  const handleCreateTerminalFromEmptyPane = useCallback(() => {
    terminalCommands.createWorkspaceTerminal(workspaceId);
  }, [terminalCommands, workspaceId]);

  return (
    <div
      data-pane-id={leaf.id}
      data-workspace-id={workspaceId}
      className="flex flex-col h-full overflow-hidden rounded-sm relative"
    >
      {!hideTabBar && (
        <WorkspaceTabBar
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
          background: "var(--theme-terminal-bg, var(--theme-bg))",
          pointerEvents: isResizing ? "none" : undefined,
        }}
        onPointerDownCapture={handlePanePointerDownCapture}
      >
        {/* Mount PaneEditor only for the active editor tab — dirty buffers survive via EditorStore and Monaco model registry */}
        {leaf.tabs[leaf.selectedIndex]?.kind === "editor" && (
          <PaneEditor
            key={`pane-editor-${leaf.id}`}
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            relativePath={(leaf.tabs[leaf.selectedIndex] as { path: string }).path}
          />
        )}

        {leaf.tabs.map((tab, idx) => {
          const isActiveTab = idx === leaf.selectedIndex;
          if (tab.kind === "editor") return null;
          if (tab.kind === "diff") {
            return (
              <div
                key={tabKey(tab)}
                className="absolute inset-0 overflow-hidden"
                style={!isActiveTab ? { visibility: "hidden", pointerEvents: "none" } : undefined}
                aria-hidden={!isActiveTab || undefined}
              >
                <DiffViewer
                  workspaceRoot={workspaceRoot}
                  relativePath={tab.path}
                  source={tab.source}
                  isActive={isActiveTab}
                  readWorkingCopy={(path) => editorReadWorkingCopyText(workspaceId, path)}
                />
              </div>
            );
          }
          if (tab.kind === "review") {
            return (
              <div
                key={tabKey(tab)}
                className="absolute inset-0 overflow-hidden"
                style={!isActiveTab ? { visibility: "hidden", pointerEvents: "none" } : undefined}
                aria-hidden={!isActiveTab || undefined}
              >
                <ReviewViewer
                  workspaceId={workspaceId}
                  workspaceRoot={workspaceRoot}
                />
              </div>
            );
          }
          const slot = slotsMap[tab.slotId];
          const sessionForSlot =
            Object.values(sessionsMap).find(
              (s) => s.slotID === tab.slotId && s.status === "running",
            ) ?? (slot?.sessionIDs[0] ? sessionsMap[slot.sessionIDs[0]] : undefined);
          const sessionId = sessionForSlot?.id ?? slot?.sessionIDs[0] ?? null;
          if (!sessionId) return null;
          if (!isActiveTab && !connectedSlotIds.has(tab.slotId)) return null;
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
              onClick={handleCreateTerminalFromEmptyPane}
              className="mt-2 rounded-md bg-[var(--theme-panel-elevated)] px-3 py-1.5 text-sm text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-panel-hover)]"
            >
              New Terminal
            </button>
            <p className="mt-1 max-w-xs text-xs text-[var(--theme-text-faint)]">
              or open a file from the file tree
            </p>
          </div>
        )}

        {!onlyEditors && !anyTerminalRenderable && terminalSlots.length > 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center text-[var(--theme-text-subtle)]">
            <DotGridLoader
              variant="default"
              gridSize={5}
              sizeClassName="h-8 w-8"
              className="opacity-90"
            />
          </div>
        )}
      </div>
    </div>
  );
}

const MemoPaneView = memo(PaneView);

type LayoutRendererProps = {
  node: import("@/lib/shared/types").LayoutNode;
  connectedSlotIds: ReadonlySet<string>;
  focusedPaneID: string | null;
  workspaceId: string;
  workspaceRoot: string;
  layoutTargetOnFocus: string | null;
  hideTabBar?: boolean;
  isResizing?: boolean;
};

function LayoutRenderer({
  node,
  connectedSlotIds,
  focusedPaneID,
  workspaceId,
  workspaceRoot,
  layoutTargetOnFocus,
  hideTabBar = false,
  isResizing,
}: LayoutRendererProps) {
  const [localResizing, setLocalResizing] = useState(false);
  const anyResizing = isResizing || localResizing;
  useNativeTerminalOverlay(localResizing ? "semi-transparent" : null);

  if (node.type === "leaf") {
    return (
      <MemoPaneView
        leaf={node}
        isFocused={node.id === focusedPaneID}
        connectedSlotIds={connectedSlotIds}
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
            <TerminalResizeHandle
              direction={direction === "horizontal" ? "horizontal" : "vertical"}
              onDragging={setLocalResizing}
            />
          )}
          <ResizablePanel defaultSize={node.ratios[i] * 100} minSize={10}>
            <MemoLayoutRenderer
              node={child}
              connectedSlotIds={connectedSlotIds}
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

function HoistedNativeTerminals({ anchors }: { anchors: Record<string, TerminalAnchorInfo> }) {
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

type WorkspaceRuntimeViewProps = {
  workspaceId: string;
  workspaceRoot: string;
  layout: import("@/services/workspace/layout-store").WorkspaceLayoutState;
  layoutTargetOnFocus?: string | null;
  isVisible?: boolean;
};

export function WorkspaceRuntimeView({
  workspaceId,
  workspaceRoot,
  layout,
  layoutTargetOnFocus = null,
  isVisible = true,
}: WorkspaceRuntimeViewProps) {
  const [anchors, setAnchors] = useState<Record<string, TerminalAnchorInfo>>({});
  const visibleSlotIds = useMemo(
    () => getVisibleWorkspaceTerminalSlotIds(layout.root),
    [layout.root],
  );
  const liveSlots = useTerminalScopeStore((s) => s.byScopeId[workspaceId]?.slots ?? EMPTY_SLOTS);
  const liveSlotIds = useMemo(() => liveSlots.map((slot) => slot.id), [liveSlots]);
  const connectedSlotIds = useLazyTerminalSlotConnections(workspaceId, visibleSlotIds, liveSlotIds);

  const registerTerminalAnchor = useCallback(
    (sessionId: string, info: TerminalAnchorInfo | null) => {
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
    },
    [],
  );

  const terminalRegistration = useMemo<NativeTerminalRegistration>(
    () => ({
      register: registerTerminalAnchor,
      workspaceVisible: isVisible,
    }),
    [registerTerminalAnchor, isVisible],
  );

  if (!layout.root) {
    return (
      <NativeTerminalRegContext.Provider value={terminalRegistration}>
        <div className="relative h-full w-full min-h-0">
          <EmptyWorkspaceLayout workspaceId={workspaceId} />
        </div>
      </NativeTerminalRegContext.Provider>
    );
  }

  return (
    <NativeTerminalRegContext.Provider value={terminalRegistration}>
      <div className="relative h-full w-full min-h-0">
        <div className="relative h-full min-h-0 min-w-0">
          <MemoLayoutRenderer
            node={layout.root!}
            connectedSlotIds={connectedSlotIds}
            focusedPaneID={layout.focusedPaneID}
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
  const workspace = useSelectedWorkspace();
  const project = useSelectedProject();
  const booting = useUiPreferences((p) => !p.sidebarHydrated || !p.fileTreeHydrated);
  const workspaceCommands = useWorkspaceActions();
  const handleRetryWorkspace = useCallback(() => {
    if (!workspace) return;
    workspaceCommands.retryWorkspace(workspace.id);
  }, [workspace, workspaceCommands]);
  const handleRemoveWorkspace = useCallback(() => {
    if (!workspace) return;
    workspaceCommands.removeWorkspace(workspace.id);
  }, [workspace, workspaceCommands]);

  if (!workspace) {
    if (booting) {
      return (
        <div className="flex items-center justify-center h-full text-[var(--theme-text-faint)]">
          <div className="text-center">
            <DotGridLoader
              variant="default"
              gridSize={5}
              sizeClassName="h-8 w-8"
              className="opacity-90"
            />
          </div>
        </div>
      );
    }
    if (!project) {
      return <WelcomeScreen />;
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
          <DotGridLoader
            variant="default"
            gridSize={5}
            sizeClassName="h-8 w-8"
            className="opacity-90"
          />
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
              onClick={handleRetryWorkspace}
              className="flex items-center gap-1.5 rounded-md bg-[var(--theme-panel-elevated)] px-3 py-1.5 text-sm text-[var(--theme-text)] transition-colors hover:bg-[var(--theme-panel-hover)]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
            <button
              onClick={handleRemoveWorkspace}
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

function WorkspaceLayoutLoading() {
  return (
    <div className="flex h-full items-center justify-center text-[var(--theme-text-subtle)]">
      <div className="text-center">
        <DotGridLoader
          variant="default"
          gridSize={5}
          sizeClassName="h-8 w-8"
          className="opacity-90"
        />
      </div>
    </div>
  );
}

export default memo(function WorkspaceView() {
  const selectedWorkspaceID = useSelectedWorkspaceId();
  const selectedWs = useSelectedWorkspace();
  const layout = useLayoutStore((state) =>
    selectedWorkspaceID ? (state.byWorkspaceId[selectedWorkspaceID] ?? null) : null,
  );
  const workspaceCommands = useWorkspaceActions();
  const handleRootPointerDownCapture = useCallback(() => {
    workspaceCommands.setLayoutTargetScopeId(null);
    workspaceCommands.setNavigationArea("workspace");
  }, [workspaceCommands]);

  if (!selectedWs || selectedWs.status !== "ready") {
    return <EmptyWorkspaceState />;
  }

  if (!layout?.layoutLoaded && !layout?.layoutLoading && !layout?.root) {
    return <EmptyWorkspaceLayout workspaceId={selectedWorkspaceID!} />;
  }

  return (
    <div
      className="relative h-full min-h-0"
      onPointerDownCapture={handleRootPointerDownCapture}
    >
      {layout?.layoutLoading && !layout.root ? <WorkspaceLayoutLoading /> : null}
      <WorkspaceRuntimeView
        key={selectedWorkspaceID}
        workspaceId={selectedWorkspaceID!}
        workspaceRoot={selectedWs.worktreePath}
        layout={layout ?? { root: null, focusedPaneID: null, layoutLoading: true, layoutLoaded: false }}
        layoutTargetOnFocus={null}
        isVisible={true}
      />
    </div>
  );
});
