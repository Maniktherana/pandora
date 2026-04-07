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
import { PanelResizeHandle } from "react-resizable-panels";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import TerminalSurface from "@/components/terminal/terminal-surface";
import { useLazyTerminalSlotConnections } from "@/hooks/use-lazy-terminal-slot-connections";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { useNativeTerminalOverlay } from "@/hooks/use-native-terminal-overlay";
import { useProjectTerminalActions } from "@/hooks/use-terminal-actions";
import { useWorkspaceActions } from "@/hooks/use-workspace-actions";
import type { SlotState, WorkspaceRuntimeState } from "@/lib/shared/types";
import { panelResizeHandleClasses } from "@/lib/shared/utils";
import { cn } from "@/lib/shared/utils";
import { getVisibleProjectTerminalSlotIds } from "@/lib/terminal/lazy-terminal-connections";
import { terminalTheme } from "@/lib/terminal/terminal-theme";
import ProjectTerminalSidebar from "./project-terminal-sidebar";
import { ProjectTerminalAnchorInfo } from "../project-terminal.types";
import { createSlotMap, createSessionMap } from "../project-terminal.utils";

type ProjectTerminalViewProps = {
  runtime: WorkspaceRuntimeState;
  workspaceId: string;
};

const NativeTerminalRegContext = createContext<
  ((sessionId: string, info: ProjectTerminalAnchorInfo | null) => void) | null
>(null);

function ProjectTerminalAnchorSlot({
  sessionId,
  slotId,
  workspaceId,
  isVisible,
  isFocused,
}: {
  sessionId: string;
  slotId: string;
  workspaceId: string;
  isVisible: boolean;
  isFocused: boolean;
}) {
  const registerTerminalAnchor = useContext(NativeTerminalRegContext);
  const anchorRef = useRef<HTMLDivElement>(null);
  const projectTerminalCommands = useProjectTerminalActions();
  const workspaceCommands = useWorkspaceActions();
  const layoutTargetRuntimeId = useDesktopView((view) => view.layoutTargetRuntimeId);
  const ownsNativeFocus = layoutTargetRuntimeId === workspaceId;

  const handleFocus = useCallback(() => {
    workspaceCommands.setLayoutTargetRuntimeId(workspaceId);
    workspaceCommands.setNavigationArea("workspace");
    projectTerminalCommands.focusProjectTerminal(workspaceId, slotId);
  }, [projectTerminalCommands, slotId, workspaceCommands, workspaceId]);

  useLayoutEffect(() => {
    if (!registerTerminalAnchor) return;
    const el = anchorRef.current;
    if (!el) return;
    console.debug("[terminal-surface]", "anchor register", {
      workspaceId,
      sessionId,
      visible: isVisible,
      focused: isVisible && isFocused,
    });
    registerTerminalAnchor(sessionId, {
      el,
      visible: isVisible,
      focused: isVisible && ownsNativeFocus && isFocused,
      onFocus: handleFocus,
    });
  }, [handleFocus, isFocused, isVisible, ownsNativeFocus, registerTerminalAnchor, sessionId]);

  useLayoutEffect(() => {
    if (!registerTerminalAnchor) return;
    return () => {
      console.debug("[terminal-surface]", "anchor unregister", {
        workspaceId,
        sessionId,
        visible: isVisible,
        focused: isVisible && isFocused,
      });
      registerTerminalAnchor(sessionId, null);
    };
  }, [registerTerminalAnchor, sessionId, workspaceId, isVisible, isFocused]);

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
  workspaceId,
  groupId,
  slot,
  sessionId,
  visible,
  active,
}: {
  connectedSlotIds: ReadonlySet<string>;
  workspaceId: string;
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
      data-bottom-terminal-runtime-id={workspaceId}
      data-bottom-terminal-group-id={groupId}
      className={cn(
        "relative h-full min-h-0 overflow-hidden rounded-sm bg-neutral-950",
        active ? "ring-1 ring-neutral-700/60" : "",
      )}
      style={{ background: terminalTheme.background ?? "#0a0a0a" }}
      onPointerDownCapture={() => {
        if (visible) projectTerminalCommands.focusProjectTerminal(workspaceId, slot?.id ?? null);
      }}
    >
      {sessionId && slot && (visible || connectedSlotIds.has(slot.id)) ? (
        <ProjectTerminalAnchorSlot
          sessionId={sessionId}
          slotId={slot.id}
          workspaceId={workspaceId}
          isVisible={visible}
          isFocused={visible && active}
        />
      ) : null}
    </div>
  );
}

function ResizableTerminalGroup({ children }: { children: ReactNode }) {
  const [isResizing, setIsResizing] = useState(false);
  useNativeTerminalOverlay(isResizing);
  const childArray = useMemo(() => (Array.isArray(children) ? children : [children]), [children]);

  return (
    <ResizablePanelGroup direction="horizontal">
      {childArray.map((child, index) => (
        <div key={index} className="contents">
          {index > 0 && (
            <PanelResizeHandle
              hitAreaMargins={{ coarse: 10, fine: 8 }}
              className={panelResizeHandleClasses("horizontal")}
              onDragging={setIsResizing}
            />
          )}
          {child}
        </div>
      ))}
    </ResizablePanelGroup>
  );
}

function HoistedNativeTerminals({
  workspaceId,
  anchors,
}: {
  workspaceId: string;
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
            workspaceId={workspaceId}
            visible={anchor.visible}
            focused={anchor.focused}
            onFocus={anchor.onFocus}
          />
        );
      })}
    </>
  );
}

export default function ProjectTerminalView({ runtime, workspaceId }: ProjectTerminalViewProps) {
  const [anchors, setAnchors] = useState<Record<string, ProjectTerminalAnchorInfo>>({});
  const panel = runtime.terminalPanel;
  const visibleSlotIds = useMemo(() => getVisibleProjectTerminalSlotIds(panel), [panel]);
  const liveSlotIds = useMemo(() => runtime.slots.map((slot) => slot.id), [runtime.slots]);
  const connectedSlotIds = useLazyTerminalSlotConnections(workspaceId, visibleSlotIds, liveSlotIds);
  const slots = runtime.slots;
  const slotMap = useMemo(() => createSlotMap(slots), [slots]);
  const sessionMap = useMemo(() => createSessionMap(runtime.sessions), [runtime.sessions]);

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

  return (
    <NativeTerminalRegContext.Provider value={registerTerminalAnchor}>
      <div className="flex h-full min-h-0 flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          {!panel || panel.groups.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-neutral-500">
              No terminals
            </div>
          ) : (
            panel.groups.map((group, groupIndex) => {
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
                      workspaceId={workspaceId}
                      groupId={group.id}
                      slot={slotMap.get(group.children[0])}
                      sessionId={
                        sessionMap.get(group.children[0])?.id ??
                        slotMap.get(group.children[0])?.sessionIDs[0] ??
                        null
                      }
                      visible={groupVisible}
                      active={groupVisible && panel.activeSlotId === group.children[0]}
                    />
                  ) : (
                    <ResizableTerminalGroup>
                      {group.children.map((slotId) => (
                        <ResizablePanel
                          key={slotId}
                          defaultSize={100 / group.children.length}
                          minSize={12}
                        >
                          <TerminalPane
                            connectedSlotIds={connectedSlotIds}
                            workspaceId={workspaceId}
                            groupId={group.id}
                            slot={slotMap.get(slotId)}
                            sessionId={
                              sessionMap.get(slotId)?.id ??
                              slotMap.get(slotId)?.sessionIDs[0] ??
                              null
                            }
                            visible={groupVisible}
                            active={groupVisible && panel.activeSlotId === slotId}
                          />
                        </ResizablePanel>
                      ))}
                    </ResizableTerminalGroup>
                  )}
                </div>
              );
            })
          )}
          <HoistedNativeTerminals workspaceId={workspaceId} anchors={anchors} />
        </div>
        <ProjectTerminalSidebar runtime={runtime} workspaceId={workspaceId} />
      </div>
    </NativeTerminalRegContext.Provider>
  );
}
