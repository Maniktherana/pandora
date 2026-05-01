import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import TerminalSurface from "@/components/terminal/terminal-surface";
import TerminalResizeHandle from "@/components/terminal/terminal-resize-handle";
import { useLazyTerminalSlotConnections } from "@/hooks/use-lazy-terminal-slot-connections";
import { useLayoutTargetScopeId } from "@/hooks/use-navigation";
import { useNativeTerminalOverlay } from "@/hooks/use-native-terminal-overlay";
import { useProjectTerminalActions } from "@/hooks/use-terminal-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import type { SlotState } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { getVisibleProjectTerminalSlotIds } from "@/lib/terminal/lazy-terminal-connections";
import ProjectTerminalSidebar from "./project-terminal-sidebar";
import type { ProjectTerminalAnchorInfo } from "../project-terminal.types";
import { createSlotMap, createSessionMap } from "../project-terminal.utils";
import { useTerminalScopeStore } from "@/services/terminal/terminal-scope-store";

type ProjectTerminalViewProps = {
  scopeId: string;
};

const NativeTerminalRegContext = createContext<
  ((sessionId: string, info: ProjectTerminalAnchorInfo | null) => void) | null
>(null);

function ProjectTerminalAnchorSlot({
  sessionId,
  slotId,
  scopeId,
  isVisible,
  isFocused,
}: {
  sessionId: string;
  slotId: string;
  scopeId: string;
  isVisible: boolean;
  isFocused: boolean;
}) {
  const registerTerminalAnchor = useContext(NativeTerminalRegContext);
  const anchorRef = useRef<HTMLDivElement>(null);
  const projectTerminalCommands = useProjectTerminalActions();
  const workspaceCommands = useWorkspaceActions();
  const layoutTargetScopeId = useLayoutTargetScopeId();
  const ownsNativeFocus = layoutTargetScopeId === scopeId;

  const handleFocus = useCallback(() => {
    workspaceCommands.setLayoutTargetScopeId(scopeId);
    workspaceCommands.setNavigationArea("workspace");
    projectTerminalCommands.focusProjectTerminal(scopeId, slotId);
  }, [projectTerminalCommands, slotId, workspaceCommands, scopeId]);

  useLayoutEffect(() => {
    if (!registerTerminalAnchor) return;
    const el = anchorRef.current;
    if (!el) return;
    registerTerminalAnchor(sessionId, {
      el,
      visible: isVisible,
      focused: isVisible && ownsNativeFocus && isFocused,
      onFocus: handleFocus,
    });
  }, [
    handleFocus,
    isFocused,
    isVisible,
    ownsNativeFocus,
    registerTerminalAnchor,
    sessionId,
    scopeId,
  ]);

  useLayoutEffect(() => {
    if (!registerTerminalAnchor) return;
    return () => {
      registerTerminalAnchor(sessionId, null);
    };
  }, [registerTerminalAnchor, sessionId, scopeId]);

  return (
    <div
      ref={anchorRef}
      className="absolute inset-0"
      style={{
        visibility: isVisible ? "visible" : "hidden",
        pointerEvents: isVisible ? "auto" : "none",
      }}
      aria-hidden={!isVisible}
    />
  );
}

function TerminalPane({
  connectedSlotIds,
  scopeId,
  groupId,
  slot,
  sessionId,
  visible,
  active,
}: {
  connectedSlotIds: ReadonlySet<string>;
  scopeId: string;
  groupId: string;
  slot: SlotState | undefined;
  sessionId: string | null;
  visible: boolean;
  active: boolean;
}) {
  const projectTerminalCommands = useProjectTerminalActions();

  return (
    <div
      data-bottom-terminal-pane-id={slot?.id ?? ""}
      data-bottom-terminal-scope-id={scopeId}
      data-bottom-terminal-group-id={groupId}
      className={cn("relative h-full min-h-0 overflow-hidden rounded-sm bg-neutral-950", {
        "ring-1 ring-neutral-700/60": active,
      })}
      style={{ background: "var(--theme-terminal-bg, var(--theme-bg))" }}
      onPointerDownCapture={() => {
        if (visible) projectTerminalCommands.focusProjectTerminal(scopeId, slot?.id ?? null);
      }}
    >
      {sessionId && slot && (visible || connectedSlotIds.has(slot.id)) ? (
        <ProjectTerminalAnchorSlot
          sessionId={sessionId}
          slotId={slot.id}
          scopeId={scopeId}
          isVisible={visible}
          isFocused={visible && active}
        />
      ) : null}
    </div>
  );
}

function ResizableTerminalGroup({ children }: { children: ReactNode }) {
  const [isResizing, setIsResizing] = useState(false);
  useNativeTerminalOverlay(isResizing ? "semi-transparent" : null);
  const childArray = useMemo(() => (Array.isArray(children) ? children : [children]), [children]);

  return (
    <ResizablePanelGroup direction="horizontal">
      {childArray.map((child, index) => (
        <div key={index} className="contents">
          {index > 0 && <TerminalResizeHandle direction="horizontal" onDragging={setIsResizing} />}
          {child}
        </div>
      ))}
    </ResizablePanelGroup>
  );
}

function HoistedNativeTerminals({
  scopeId,
  anchors,
}: {
  scopeId: string;
  anchors: Record<string, ProjectTerminalAnchorInfo>;
}) {
  const sessionIds = useMemo(() => Object.keys(anchors), [anchors]);

  return (
    <>
      {sessionIds.map((sessionId) => {
        const anchor = anchors[sessionId];
        if (!anchor) return null;
        return (
          <TerminalSurface
            key={sessionId}
            anchorElement={anchor.el}
            sessionID={sessionId}
            surfaceId={sessionId}
            workspaceId={scopeId}
            visible={anchor.visible}
            focused={anchor.focused}
            onFocus={anchor.onFocus}
          />
        );
      })}
    </>
  );
}

export default function ProjectTerminalView({ scopeId }: ProjectTerminalViewProps) {
  const [anchors, setAnchors] = useState<Record<string, ProjectTerminalAnchorInfo>>({});
  const scope = useTerminalScopeStore((s) => s.byScopeId[scopeId]);
  const panel = scope?.terminalPanel ?? null;
  const slots = scope?.slots ?? [];
  const sessions = scope?.sessions ?? [];

  const visibleSlotIds = useMemo(() => getVisibleProjectTerminalSlotIds(panel), [panel]);
  const liveSlotIds = useMemo(() => slots.map((slot) => slot.id), [slots]);
  const connectedSlotIds = useLazyTerminalSlotConnections(scopeId, visibleSlotIds, liveSlotIds);
  const slotMap = useMemo(() => createSlotMap(slots), [slots]);
  const sessionMap = useMemo(() => createSessionMap(sessions), [sessions]);
  const isEmpty = !panel || panel.groups.length === 0;

  const registerTerminalAnchor = useCallback(
    (sessionId: string, info: ProjectTerminalAnchorInfo | null) => {
      setAnchors((prev) => {
        if (info == null) {
          if (!(sessionId in prev)) return prev;
          const next = { ...prev };
          delete next[sessionId];
          return next;
        }
        const existing = prev[sessionId];
        if (
          existing &&
          existing.el === info.el &&
          existing.visible === info.visible &&
          existing.focused === info.focused &&
          existing.onFocus === info.onFocus
        ) {
          return prev;
        }
        return { ...prev, [sessionId]: info };
      });
    },
    [],
  );

  if (isEmpty) {
    return null;
  }

  return (
    <NativeTerminalRegContext.Provider value={registerTerminalAnchor}>
      <div className="flex h-full min-h-0 flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          {panel.groups.map((group, groupIndex) => {
            const groupVisible = panel.visible && groupIndex === panel.activeGroupIndex;
            return (
              <div
                key={group.id}
                className="absolute inset-0"
                style={{
                  visibility: groupVisible ? "visible" : "hidden",
                  pointerEvents: groupVisible ? "auto" : "none",
                }}
                aria-hidden={!groupVisible}
              >
                {group.children.length === 1 ? (
                  <TerminalPane
                    connectedSlotIds={connectedSlotIds}
                    scopeId={scopeId}
                    groupId={group.id}
                    slot={slotMap.get(group.children[0])}
                    sessionId={sessionMap.get(group.children[0])?.id ?? null}
                    visible={groupVisible}
                    active={groupVisible && panel.activeSlotId === group.children[0]}
                  />
                ) : (
                  <ResizableTerminalGroup>
                    {group.children.map((slotId) => (
                      <ResizablePanel key={slotId} defaultSize={100 / group.children.length} minSize={12}>
                        <TerminalPane
                          connectedSlotIds={connectedSlotIds}
                          scopeId={scopeId}
                          groupId={group.id}
                          slot={slotMap.get(slotId)}
                          sessionId={sessionMap.get(slotId)?.id ?? null}
                          visible={groupVisible}
                          active={groupVisible && panel.activeSlotId === slotId}
                        />
                      </ResizablePanel>
                    ))}
                  </ResizableTerminalGroup>
                )}
              </div>
            );
          })}
          <HoistedNativeTerminals scopeId={scopeId} anchors={anchors} />
        </div>
        <ProjectTerminalSidebar scopeId={scopeId} />
      </div>
    </NativeTerminalRegContext.Provider>
  );
}
