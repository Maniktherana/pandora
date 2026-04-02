import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PanelResizeHandle } from "react-resizable-panels";
import { ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import BottomTerminalSidebar from "@/components/terminal/bottom-terminal-sidebar";
import TerminalSurface from "@/components/terminal/terminal-surface";
import { useProjectTerminalCommands, useWorkspaceCommands } from "@/hooks/use-app-view";
import type { SessionState, SlotState, WorkspaceRuntimeState } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { terminalTheme } from "@/lib/terminal/terminal-theme";

type TerminalAnchorInfo = {
  el: HTMLElement;
  visible: boolean;
  focused: boolean;
  onFocus?: () => void;
};

const NativeTerminalRegContext = createContext<
  ((sessionId: string, info: TerminalAnchorInfo | null) => void) | null
>(null);

function ProjectTerminalAnchorSlot({
  session,
  slotId,
  workspaceId,
  isVisible,
  isFocused,
}: {
  session: SessionState;
  slotId: string;
  workspaceId: string;
  isVisible: boolean;
  isFocused: boolean;
}) {
  const registerTerminalAnchor = useContext(NativeTerminalRegContext);
  const anchorRef = useRef<HTMLDivElement>(null);
  const projectTerminalCommands = useProjectTerminalCommands();
  const workspaceCommands = useWorkspaceCommands();

  const handleFocus = useCallback(() => {
    workspaceCommands.setLayoutTargetRuntimeId(workspaceId);
    workspaceCommands.setNavigationArea("workspace");
    projectTerminalCommands.focusProjectTerminal(workspaceId, slotId);
  }, [
    projectTerminalCommands,
    slotId,
    workspaceCommands,
    workspaceId,
  ]);

  useLayoutEffect(() => {
    if (!registerTerminalAnchor) return;
    const el = anchorRef.current;
    if (!el) return;
    registerTerminalAnchor(session.id, {
      el,
      visible: isVisible,
      focused: isVisible && isFocused,
      onFocus: handleFocus,
    });
  }, [handleFocus, isFocused, isVisible, registerTerminalAnchor, session.id]);

  useLayoutEffect(() => {
    if (!registerTerminalAnchor) return;
    return () => registerTerminalAnchor(session.id, null);
  }, [registerTerminalAnchor, session.id]);

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
  workspaceId,
  groupId,
  slot,
  session,
  visible,
  active,
}: {
  workspaceId: string;
  groupId: string;
  slot: SlotState | undefined;
  session: SessionState | undefined;
  visible: boolean;
  active: boolean;
}) {
  const projectTerminalCommands = useProjectTerminalCommands();

  return (
    <div
      data-bottom-terminal-pane-id={slot?.id ?? ""}
      data-bottom-terminal-runtime-id={workspaceId}
      data-bottom-terminal-group-id={groupId}
      className={cn(
        "relative h-full min-h-0 overflow-hidden rounded-sm border bg-neutral-950",
        active ? "border-neutral-700" : "border-neutral-800"
      )}
      style={{ background: terminalTheme.background ?? "#0a0a0a" }}
      onPointerDownCapture={() => {
        if (visible) projectTerminalCommands.focusProjectTerminal(workspaceId, slot?.id ?? null);
      }}
    >
      {session?.status === "running" && slot ? (
        <ProjectTerminalAnchorSlot
          session={session}
          slotId={slot.id}
          workspaceId={workspaceId}
          isVisible={visible}
          isFocused={visible && active}
        />
      ) : slot?.aggregateStatus !== "stopped" ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-sm text-neutral-500">
          Connecting...
        </div>
      ) : null
      }
    </div>
  );
}

function HoistedNativeTerminals({
  workspaceId,
  runtime,
  anchors,
}: {
  workspaceId: string;
  runtime: WorkspaceRuntimeState;
  anchors: Record<string, TerminalAnchorInfo>;
}) {
  const runningSessions = useMemo(
    () => runtime.sessions.filter((session) => session.status === "running"),
    [runtime.sessions]
  );

  return (
    <>
      {runningSessions.map((session) => {
        const anchor = anchors[session.id];
        if (!anchor) return null;
        return (
          <TerminalSurface
            key={session.id}
            anchorElement={anchor.el}
            sessionID={session.id}
            surfaceId={session.id}
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

export default function BottomTerminalPanelView({
  runtime,
  workspaceId,
}: {
  runtime: WorkspaceRuntimeState;
  workspaceId: string;
}) {
  const [anchors, setAnchors] = useState<Record<string, TerminalAnchorInfo>>({});
  const panel = runtime.terminalPanel;
  const slots = runtime.slots;
  const slotMap = useMemo(() => {
    const map = new Map<string, SlotState>();
    for (const slot of slots) map.set(slot.id, slot);
    return map;
  }, [slots]);
  const sessionMap = useMemo(() => {
    const map = new Map<string, SessionState>();
    for (const session of runtime.sessions) {
      if (!map.has(session.slotID) || session.status === "running") {
        map.set(session.slotID, session);
      }
    }
    return map;
  }, [runtime.sessions]);

  const registerTerminalAnchor = useCallback((sessionId: string, info: TerminalAnchorInfo | null) => {
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
  }, []);

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
                      workspaceId={workspaceId}
                      groupId={group.id}
                      slot={slotMap.get(group.children[0])}
                      session={sessionMap.get(group.children[0])}
                      visible={groupVisible}
                      active={groupVisible}
                    />
                  ) : (
                    <ResizablePanelGroup direction="horizontal">
                      {group.children.map((slotId, index) => (
                        <div key={slotId} className="contents">
                          {index > 0 && (
                            <PanelResizeHandle
                              hitAreaMargins={{ coarse: 0, fine: 0 }}
                              className="z-20 h-full min-h-0 w-[2px] min-w-[2px] max-w-[2px] shrink-0 cursor-col-resize bg-neutral-600 transition-colors hover:bg-blue-500"
                            />
                          )}
                          <ResizablePanel defaultSize={100 / group.children.length} minSize={12}>
                            <TerminalPane
                              workspaceId={workspaceId}
                              groupId={group.id}
                              slot={slotMap.get(slotId)}
                              session={sessionMap.get(slotId)}
                              visible={groupVisible}
                              active={groupVisible && panel.activeSlotId === slotId}
                            />
                          </ResizablePanel>
                        </div>
                      ))}
                    </ResizablePanelGroup>
                  )}
                </div>
              );
            })
          )}
          <HoistedNativeTerminals workspaceId={workspaceId} runtime={runtime} anchors={anchors} />
        </div>
        <BottomTerminalSidebar runtime={runtime} workspaceId={workspaceId} />
      </div>
    </NativeTerminalRegContext.Provider>
  );
}
