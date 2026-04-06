import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GitCompare, Plus, X } from "lucide-react";
import { FileTypeIcon } from "@/components/files/file-type-icon";
import TerminalIdentityIcon from "@/components/terminal/terminal-identity-icon";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { useWorkspaceView } from "@/hooks/use-desktop-view";
import { useLayoutActions } from "@/hooks/use-layout-actions";
import { useTerminalActions } from "@/hooks/use-terminal-actions";
import { useEditorStore } from "@/stores/editor-store";
import { tabKey } from "@/lib/layout/layout-tree";
import type {
  PaneTab,
  SessionState,
  SlotState,
  TerminalDisplayState,
} from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { terminalDisplayForSlot } from "@/lib/terminal/terminal-identity";
import { scmStatus, scmToneTextClass, statusTone, type ScmStatusEntry } from "@/lib/workspace/scm";
import { useTabDrag } from "./tab-drag-layer";

interface TabBarProps {
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
  displayMap: Record<string, TerminalDisplayState>
): TerminalDisplayState {
  if (tab.kind !== "terminal") {
    return { kind: "terminal", label: "" };
  }
  return terminalDisplayForSlot(slotsMap[tab.slotId], sessionsMap[tab.slotId], displayMap[tab.slotId]);
}

function tabLabel(
  tab: PaneTab,
  slotsMap: Record<string, SlotState | undefined>,
  sessionsMap: Record<string, SessionState | undefined>,
  displayMap: Record<string, TerminalDisplayState>
): string {
  if (tab.kind === "terminal") {
    return terminalTabDisplay(tab, slotsMap, sessionsMap, displayMap).label;
  }
  const base = tab.path.split("/").pop() ?? tab.path;
  if (tab.kind === "diff") {
    return tab.source === "staged" ? `${base} · staged` : `${base} · diff`;
  }
  return base;
}

function EditorTabCloseControl({
  workspaceId,
  workspaceRoot,
  paneID,
  index,
  path,
  label,
  isActive,
}: {
  workspaceId: string;
  workspaceRoot: string;
  paneID: string;
  index: number;
  path: string;
  label: string;
  isActive: boolean;
}) {
  const isDirty = useEditorStore((s) => s.isFileDirty(workspaceId, path));
  const { closeEditorTab } = useEditorActions();

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={isDirty ? `Close ${label} (unsaved changes)` : `Close ${label}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void closeEditorTab({
          workspaceId,
          workspaceRoot,
          paneID,
          tabIndex: index,
          relativePath: path,
          displayName: label,
        });
      }}
      className={cn(
        "ml-1 flex h-4 w-4 items-center justify-center rounded-sm transition-colors",
        isActive
          ? "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
          : "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200"
      )}
    >
      {isDirty ? (
        <span className="h-2 w-2 shrink-0 rounded-full bg-current" aria-hidden />
      ) : (
        <X className="h-3 w-3" aria-hidden />
      )}
    </div>
  );
}

export default function PaneTabBar({
  paneID,
  tabs,
  selectedIndex,
  workspaceId,
  workspaceRoot,
  isFocused,
}: TabBarProps) {
  const { startDrag, dragState } = useTabDrag();
  const layoutCommands = useLayoutActions();
  const terminalCommands = useTerminalActions();
  const runtime = useWorkspaceView(workspaceId, (view) => view.runtime);
  const slotsMap = useMemo(
    () =>
      Object.fromEntries((runtime?.slots ?? []).map((slot) => [slot.id, slot] as const)) as Record<
        string,
        SlotState | undefined
      >,
    [runtime?.slots]
  );
  const displayMap = runtime?.terminalDisplayBySlotId ?? {};
  const sessions = runtime?.sessions ?? [];
  const sessionsMap = useMemo(
    () =>
      Object.fromEntries(sessions.map((session) => [session.slotID, session] as const)) as Record<
        string,
        SessionState | undefined
      >,
    [sessions]
  );
  const [scmEntries, setScmEntries] = useState<ScmStatusEntry[]>([]);
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
    [tabs, slotsMap, sessionsMap, displayMap]
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
    [paneID, startDrag]
  );

  const handlePointerUp = useCallback(
    (_e: React.PointerEvent, index: number) => {
      if (pendingDragRef.current) {
        layoutCommands.selectTabInPane(paneID, index);
        layoutCommands.setFocusedPane(paneID);
        pendingDragRef.current = null;
      }
    },
    [layoutCommands, paneID]
  );

  const closeTerminalTab = useCallback(
    (index: number) => {
      const tab = tabs[index];
      if (!tab || tab.kind !== "terminal") return;
      terminalCommands.closeTerminalSlot(workspaceId, tab.slotId);
    },
    [tabs, terminalCommands, workspaceId]
  );

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void scmStatus(workspaceRoot)
        .then((list) => {
          if (!cancelled) setScmEntries(list);
        })
        .catch(() => {
          if (!cancelled) setScmEntries([]);
        });
    };
    refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [workspaceRoot]);

  const scmByPath = useMemo(() => new Map(scmEntries.map((entry) => [entry.path, entry])), [scmEntries]);

  const rowRef = useRef<HTMLDivElement>(null);
  const tabsWrapRef = useRef<HTMLDivElement>(null);
  const plusWrapRef = useRef<HTMLDivElement>(null);
  const [pinPlus, setPinPlus] = useState(false);

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
      className="flex h-8 min-w-0 items-stretch border-b border-neutral-800 bg-neutral-900/80"
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
            pinPlus ? "flex-1" : "w-max max-w-full"
          )}
        >
        {tabs.map((tab, index) => {
        const isLast = index === tabs.length - 1;
        const isActive = index === selectedIndex;
        const isBeingDragged =
          dragState?.kind === "pane-tab" &&
          dragState.sourcePaneID === paneID &&
          dragState.sourceIndex === index;

        const terminalDisplay =
          tab.kind === "terminal" ? terminalTabDisplay(tab, slotsMap, sessionsMap, displayMap) : null;
        return (
          <div
              key={tabKey(tab)}
              data-tab-pane={paneID}
              data-tab-index={index}
              data-tab-kind={tab.kind}
              data-workspace-id={workspaceId}
              onPointerDown={(e) => handlePointerDown(e, index)}
              onPointerUp={(e) => handlePointerUp(e, index)}
              className={cn(
                "relative flex h-full shrink-0 cursor-default select-none items-center gap-1.5 pl-3 pr-1.5 text-xs",
                !isLast && "border-r border-neutral-800",
                isActive && isFocused
                  ? "bg-neutral-900 text-neutral-200 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-neutral-200 after:content-['']"
                  : isActive
                    ? "bg-neutral-900 text-neutral-200 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-neutral-800 after:content-['']"
                    : "text-neutral-500 hover:bg-neutral-800/30 hover:text-neutral-300",
                isBeingDragged && "opacity-30"
              )}
            >
              {(() => {
                const scmEntry =
                  tab.kind === "editor" || tab.kind === "diff" ? scmByPath.get(tab.path) : undefined;
                const toneClass = scmEntry ? scmToneTextClass(statusTone(scmEntry)) : "";
                return (
                  <>
              {tab.kind === "editor" ? (
                <FileTypeIcon path={tab.path} kind="file" className="pointer-events-none" />
              ) : tab.kind === "diff" ? (
                <GitCompare className={cn("size-3.5 shrink-0", toneClass || "text-neutral-500")} aria-hidden />
              ) : terminalDisplay ? (
                <TerminalIdentityIcon identity={terminalDisplay} className="size-3.5 pointer-events-none" />
              ) : null}
              <span className={cn("pointer-events-none max-w-[120px] truncate", toneClass)}>
                {tabLabel(tab, slotsMap, sessionsMap, displayMap)}
              </span>
                  </>
                );
              })()}

              {tab.kind === "editor" ? (
                <EditorTabCloseControl
                  workspaceId={workspaceId}
                  workspaceRoot={workspaceRoot}
                  paneID={paneID}
                  index={index}
                  path={tab.path}
                  label={tabLabel(tab, slotsMap, sessionsMap, displayMap)}
                  isActive={isActive}
                />
              ) : tab.kind === "diff" ? (
                <div
                  role="button"
                  tabIndex={-1}
                  aria-label={`Close ${tabLabel(tab, slotsMap, sessionsMap, displayMap)}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    layoutCommands.removePaneTabByIndex(paneID, index);
                  }}
                  className={cn(
                    "ml-1 flex h-4 w-4 items-center justify-center rounded-sm transition-colors",
                    isActive
                      ? "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                      : "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200"
                  )}
                >
                  <X className="h-3 w-3" aria-hidden />
                </div>
              ) : (
                <div
                  role="button"
                  tabIndex={-1}
                  aria-label={`Close ${tabLabel(tab, slotsMap, sessionsMap, displayMap)}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTerminalTab(index);
                  }}
                  className={cn(
                    "ml-1 flex h-4 w-4 items-center justify-center rounded-sm transition-colors",
                    isActive
                      ? "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
                      : "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200"
                  )}
                >
                  <X className="h-3 w-3" aria-hidden />
                </div>
              )}

            </div>
          );
        })}
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
