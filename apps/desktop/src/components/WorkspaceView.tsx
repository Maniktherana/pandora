import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ResizablePanelGroup, ResizablePanel } from "@/components/ui/resizable";
import { PanelResizeHandle } from "react-resizable-panels";
import TerminalSurface from "@/components/Terminal";
import TabBar from "@/components/dnd/TabBar";
import { TabDragProvider } from "@/components/dnd/TabDragLayer";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { LayoutNode, LayoutLeaf, SessionState, WorkspaceRuntimeState } from "@/lib/types";
import { terminalTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { RotateCcw, Trash2 } from "lucide-react";

// ── Hoisted native terminals (stable React parent across split/merge layout moves) ──

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
}: {
  sessionForSlot: SessionState;
  isActiveTab: boolean;
  isFocused: boolean;
  workspaceId: string;
  leafId: string;
}) {
  const registerTerminalAnchor = useContext(NativeTerminalRegContext);
  const anchorRef = useRef<HTMLDivElement>(null);
  const { setFocusedPane, setNavigationArea } = useWorkspaceStore();

  const handleFocus = useCallback(() => {
    setFocusedPane(leafId);
    setNavigationArea("workspace");
  }, [leafId, setFocusedPane, setNavigationArea]);

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

// ── PaneView ───────────────────────────────────────────────────────────

interface PaneViewProps {
  leaf: LayoutLeaf;
  isFocused: boolean;
  workspaceId: string;
  isResizing?: boolean;
}

function PaneView({ leaf, isFocused, workspaceId, isResizing }: PaneViewProps) {
  const { slotsByID, sessionsByID } = useWorkspaceStore();
  const slotsMap = slotsByID(workspaceId);
  const sessionsMap = sessionsByID(workspaceId);
  const activeSlotID = leaf.slotIDs[leaf.selectedIndex] ?? leaf.slotIDs[0];
  const slot = activeSlotID ? slotsMap[activeSlotID] : null;

  return (
    <div
      data-pane-id={leaf.id}
      className="flex flex-col h-full overflow-hidden rounded-sm relative"
    >
      <TabBar
        paneID={leaf.id}
        slotIDs={leaf.slotIDs}
        selectedIndex={leaf.selectedIndex}
        workspaceId={workspaceId}
        isFocused={isFocused}
      />

      <div
        className="flex-1 min-h-0 relative"
        style={{
          background: terminalTheme.background ?? "#0a0a0a",
          pointerEvents: isResizing ? "none" : undefined,
        }}
      >
        {leaf.slotIDs.map((slotID, idx) => {
          const isActiveTab = idx === leaf.selectedIndex;
          const sessionForSlot = Object.values(sessionsMap).find(
            (s) => s.slotID === slotID && s.status === "running"
          );
          if (!sessionForSlot) return null;
          return (
            <PaneTerminalAnchorSlot
              key={slotID}
              sessionForSlot={sessionForSlot}
              isActiveTab={isActiveTab}
              isFocused={isFocused}
              workspaceId={workspaceId}
              leafId={leaf.id}
            />
          );
        })}

        {!Object.values(sessionsMap).some(
          (s) => leaf.slotIDs.includes(s.slotID) && s.status === "running"
        ) && (
          <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
            {slot ? (
              <span>
                {slot.aggregateStatus === "stopped"
                  ? "Terminal stopped"
                  : "Connecting..."}
              </span>
            ) : (
              <span>No terminal</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── LayoutRenderer ─────────────────────────────────────────────────────

interface LayoutRendererProps {
  node: LayoutNode;
  focusedPaneID: string | null;
  workspaceId: string;
  isResizing?: boolean;
}

function LayoutRenderer({ node, focusedPaneID, workspaceId, isResizing }: LayoutRendererProps) {
  const [localResizing, setLocalResizing] = useState(false);
  const anyResizing = isResizing || localResizing;

  if (node.type === "leaf") {
    return (
      <PaneView
        leaf={node}
        isFocused={node.id === focusedPaneID}
        workspaceId={workspaceId}
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
                "z-20 shrink-0 border-0 p-0 outline-none transition-colors hover:bg-blue-500",
                direction === "horizontal"
                  ? "h-full min-h-0 w-[2px] min-w-[2px] max-w-[2px] cursor-col-resize bg-neutral-500"
                  : "h-[2px] min-h-[2px] max-h-[2px] w-full cursor-row-resize bg-neutral-500"
              )}
              onDragging={setLocalResizing}
            />
          )}
          <ResizablePanel defaultSize={node.ratios[i] * 100} minSize={10}>
            <LayoutRenderer
              node={child}
              focusedPaneID={focusedPaneID}
              workspaceId={workspaceId}
              isResizing={anyResizing}
            />
          </ResizablePanel>
        </div>
      ))}
    </ResizablePanelGroup>
  );
}

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

function WorkspaceRuntimeView({
  workspaceId,
  runtime,
}: {
  workspaceId: string;
  runtime: WorkspaceRuntimeState;
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
      <div className="h-full w-full relative">
        <LayoutRenderer
          node={runtime.root!}
          focusedPaneID={runtime.focusedPaneID}
          workspaceId={workspaceId}
        />
        <HoistedNativeTerminals runtime={runtime} anchors={anchors} />
      </div>
    </NativeTerminalRegContext.Provider>
  );
}

// ── EmptyWorkspaceState ────────────────────────────────────────────────

function EmptyWorkspaceState() {
  const { selectedWorkspace, selectedProject } = useWorkspaceStore();
  const workspace = selectedWorkspace();

  if (!workspace) {
    const project = selectedProject();
    if (!project) {
      return (
        <div className="flex items-center justify-center h-full text-neutral-600">
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
      <div className="flex items-center justify-center h-full text-neutral-600">
        <div className="text-center">
          <p className="text-lg font-medium">No workspace selected</p>
          <p className="text-sm mt-1">Create a workspace in the sidebar</p>
        </div>
      </div>
    );
  }

  if (workspace.status === "creating") {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        <div className="text-center">
          <div className="w-6 h-6 border-2 border-neutral-600 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Creating workspace...</p>
          <p className="text-xs text-neutral-600 mt-1">Setting up git worktree</p>
        </div>
      </div>
    );
  }

  if (workspace.status === "failed") {
    const { retryWorkspace, removeWorkspace } = useWorkspaceStore.getState();
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        <div className="text-center max-w-md">
          <p className="text-sm text-red-400">Workspace creation failed</p>
          {workspace.failureMessage && (
            <p className="text-xs text-neutral-600 mt-1 break-words">
              {workspace.failureMessage}
            </p>
          )}
          <div className="flex gap-2 justify-center mt-4">
            <button
              onClick={() => void retryWorkspace(workspace.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-300 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retry
            </button>
            <button
              onClick={() => void removeWorkspace(workspace.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-sm text-neutral-300 transition-colors"
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

// ── WorkspaceView ──────────────────────────────────────────────────────

export default function WorkspaceView() {
  const selectedWorkspaceID = useWorkspaceStore((s) => s.selectedWorkspaceID);
  const selectedWs = useWorkspaceStore((s) => s.selectedWorkspace());
  const runtime = useWorkspaceStore(
    (s) => (selectedWorkspaceID ? s.runtimes[selectedWorkspaceID] : null)
  );

  if (!selectedWs || selectedWs.status !== "ready" || !runtime?.root) {
    return <EmptyWorkspaceState />;
  }

  return (
    <TabDragProvider>
      <WorkspaceRuntimeView workspaceId={selectedWorkspaceID!} runtime={runtime} />
    </TabDragProvider>
  );
}
