import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useRuntimeState } from "@/hooks/use-desktop-view";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { tabKey } from "@/components/layout/workspace/layout-tree";
import type { PaneTab, SessionState, SlotState, TerminalDisplayState } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { terminalDisplayForSlot } from "@/lib/terminal/terminal-identity";
import { useScmStatusQuery } from "@/components/layout/right-sidebar/scm/scm-queries";
import { useTabDrag } from "@/components/dnd/tab-drag-provider";
import { WorkspaceTab } from "@/components/layout/workspace/workspace-tab";

interface WorkspaceTabBarProps {
  paneID: string;
  tabs: PaneTab[];
  selectedIndex: number;
  workspaceId: string;
  workspaceRoot: string;
  isFocused: boolean;
}

const DRAG_THRESHOLD = 5;

function terminalTabDisplay(
  tab: PaneTab,
  slotsMap: Record<string, SlotState | undefined>,
  sessionsMap: Record<string, SessionState | undefined>,
  displayMap: Record<string, TerminalDisplayState>,
): TerminalDisplayState {
  if (tab.kind !== "terminal") {
    return { kind: "terminal", label: "" };
  }
  return terminalDisplayForSlot(
    slotsMap[tab.slotId],
    sessionsMap[tab.slotId],
    displayMap[tab.slotId],
  );
}

function tabLabel(
  tab: PaneTab,
  slotsMap: Record<string, SlotState | undefined>,
  sessionsMap: Record<string, SessionState | undefined>,
  displayMap: Record<string, TerminalDisplayState>,
): string {
  if (tab.kind === "terminal") {
    return terminalTabDisplay(tab, slotsMap, sessionsMap, displayMap).label;
  }
  if (tab.kind === "review") {
    return "Review";
  }
  const base = tab.path.split("/").pop() ?? tab.path;
  if (tab.kind === "diff") {
    return tab.source === "staged" ? `${base} · staged` : `${base} · diff`;
  }
  return base;
}

export default function WorkspaceTabBar({
  paneID,
  tabs,
  selectedIndex,
  workspaceId,
  workspaceRoot,
  isFocused,
}: WorkspaceTabBarProps) {
  const { startDrag, dragState } = useTabDrag();
  const layoutCommands = useLayoutActions();
  const terminalCommands = useTerminalActions();
  const runtime = useRuntimeState(workspaceId);
  const slotsMap = useMemo(
    () =>
      Object.fromEntries((runtime?.slots ?? []).map((slot) => [slot.id, slot] as const)) as Record<
        string,
        SlotState | undefined
      >,
    [runtime?.slots],
  );
  const displayMap = runtime?.terminalDisplayBySlotId ?? {};
  const sessions = runtime?.sessions ?? [];
  const sessionsMap = useMemo(
    () =>
      Object.fromEntries(sessions.map((session) => [session.slotID, session] as const)) as Record<
        string,
        SessionState | undefined
      >,
    [sessions],
  );
  const { data: scmEntries = [] } = useScmStatusQuery(workspaceRoot);
  const pendingDragRef = useRef<{
    sourceIndex: number;
    label: string;
    startX: number;
    startY: number;
  } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, index: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const tab = tabs[index];
      if (!tab) return;
      pendingDragRef.current = {
        sourceIndex: index,
        label: tabLabel(tab, slotsMap, sessionsMap, displayMap),
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    [tabs, slotsMap, sessionsMap, displayMap],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const pending = pendingDragRef.current;
      if (!pending) return;
      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD) {
        startDrag({
          kind: "pane-tab",
          sourcePaneID: paneID,
          sourceIndex: pending.sourceIndex,
          tabLabel: pending.label,
        });
        pendingDragRef.current = null;
      }
    },
    [paneID, startDrag],
  );

  const handlePointerUp = useCallback(
    (_e: React.PointerEvent, index: number) => {
      if (pendingDragRef.current) {
        layoutCommands.selectTabInPane(paneID, index);
        layoutCommands.setFocusedPane(paneID);
        pendingDragRef.current = null;
      }
    },
    [layoutCommands, paneID],
  );

  const closeTerminalTab = useCallback(
    (index: number) => {
      const tab = tabs[index];
      if (!tab || tab.kind !== "terminal") return;
      terminalCommands.closeTerminalSlot(workspaceId, tab.slotId);
    },
    [tabs, terminalCommands, workspaceId],
  );

  const closeDiffTab = useCallback(
    (index: number) => {
      layoutCommands.removePaneTabByIndex(paneID, index);
    },
    [layoutCommands, paneID],
  );

  const scmByPath = useMemo(
    () => new Map(scmEntries.map((entry) => [entry.path, entry])),
    [scmEntries],
  );
  const selectedTab = tabs[selectedIndex] ?? tabs[0];

  const rowRef = useRef<HTMLDivElement>(null);
  const tabsWrapRef = useRef<HTMLDivElement>(null);
  const plusWrapRef = useRef<HTMLDivElement>(null);
  const [pinPlus, setPinPlus] = useState(false);

  useLayoutEffect(() => {
    const tabsWrap = tabsWrapRef.current;
    if (!tabsWrap) return;
    const activeTab = tabsWrap.querySelector<HTMLElement>(
      `[data-tab-pane="${paneID}"][data-tab-index="${selectedIndex}"]`,
    );
    if (!activeTab) return;
    activeTab.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [paneID, selectedIndex, tabs, workspaceId]);

  const measurePlusPin = useCallback(() => {
    const row = rowRef.current;
    const tabsWrap = tabsWrapRef.current;
    const plusWrap = plusWrapRef.current;
    if (!row || !tabsWrap || !plusWrap) return;
    const tabsW = tabsWrap.scrollWidth;
    const plusW = plusWrap.offsetWidth;
    setPinPlus(tabsW + plusW > row.clientWidth + 0.5);
  }, []);

  useLayoutEffect(() => {
    measurePlusPin();
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measurePlusPin());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measurePlusPin, tabs]);

  if (tabs.length === 0) return null;

  return (
    <div
      className={cn("flex h-8 min-w-0 items-stretch border-b border-neutral-800", {
        "bg-[var(--theme-terminal-bg)]": selectedTab?.kind === "terminal",
        "bg-neutral-900/80": selectedTab?.kind !== "terminal",
      })}
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        pendingDragRef.current = null;
      }}
    >
      <div ref={rowRef} className="flex min-w-0 flex-1 items-stretch">
        <div
          ref={tabsWrapRef}
          className={cn(
            "tab-bar-hide-scrollbar flex min-w-0 items-stretch overflow-x-auto",
            pinPlus ? "flex-1" : "w-max max-w-full",
          )}
        >
          {tabs.map((tab, index) => (
            <WorkspaceTab
              key={tabKey(tab)}
              tab={tab}
              index={index}
              paneID={paneID}
              workspaceId={workspaceId}
              workspaceRoot={workspaceRoot}
              selectedIndex={selectedIndex}
              isFocused={isFocused}
              isLast={index === tabs.length - 1}
              isBeingDragged={
                dragState?.kind === "pane-tab" &&
                dragState.sourcePaneID === paneID &&
                dragState.sourceIndex === index
              }
              scmEntry={
                tab.kind === "editor" || tab.kind === "diff" ? scmByPath.get(tab.path) : undefined
              }
              slotsMap={slotsMap}
              sessionsMap={sessionsMap}
              displayMap={displayMap}
              terminalAgentStatus={
                tab.kind === "terminal"
                  ? (runtime?.terminalAgentStatusBySlotId?.[tab.slotId] ?? "idle")
                  : "idle"
              }
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onCloseDiffTab={closeDiffTab}
              onCloseTerminalTab={closeTerminalTab}
            />
          ))}
        </div>
        <div ref={plusWrapRef} className="flex shrink-0 items-stretch border-l border-neutral-800">
          <button
            type="button"
            onClick={() => terminalCommands.createWorkspaceTerminal(workspaceId)}
            className="flex h-full w-8 items-center justify-center text-neutral-500 transition-colors hover:bg-neutral-800/30 hover:text-neutral-200"
            title="New tab"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
