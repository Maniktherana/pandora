import { useCallback, useRef } from "react";
import { GitCompare, X } from "lucide-react";
import { FileTypeIcon } from "@/components/files/file-type-icon";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { tryCloseEditorTab } from "@/lib/editor/close-dirty-editor";
import { tabKey } from "@/lib/layout/layout-tree";
import type { PaneTab } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { getTerminalDaemonClient } from "@/lib/terminal/terminal-runtime";
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

function tabLabel(tab: PaneTab, slotsMap: Record<string, { name: string } | undefined>): string {
  if (tab.kind === "terminal") {
    const slot = slotsMap[tab.slotId];
    return slot?.name ?? tab.slotId.slice(0, 8);
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

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={isDirty ? `Close ${label} (unsaved changes)` : `Close ${label}`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        void tryCloseEditorTab({
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
  const { selectTabInPane, setFocusedPane, slotsByID, removePaneTabByIndex } = useWorkspaceStore();
  const { startDrag, dragState } = useTabDrag();
  const slotsMap = slotsByID(workspaceId);
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
        label: tabLabel(tab, slotsMap),
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    [tabs, slotsMap]
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
        selectTabInPane(paneID, index);
        setFocusedPane(paneID);
        pendingDragRef.current = null;
      }
    },
    [paneID, selectTabInPane, setFocusedPane]
  );

  const closeTerminalTab = useCallback(
    (index: number) => {
      const tab = tabs[index];
      if (!tab || tab.kind !== "terminal") return;
      getTerminalDaemonClient()?.send(workspaceId, {
        type: "remove_slot",
        slotID: tab.slotId,
      });
    },
    [tabs, workspaceId]
  );

  if (tabs.length === 0) return null;

  return (
    <div
      className="tab-bar-hide-scrollbar flex h-8 items-center overflow-x-auto border-b border-neutral-800 bg-neutral-900/80"
      onPointerMove={handlePointerMove}
      onPointerLeave={() => {
        pendingDragRef.current = null;
      }}
    >
      {tabs.map((tab, index) => {
        const isActive = index === selectedIndex;
        const isBeingDragged =
          dragState?.kind === "pane-tab" &&
          dragState.sourcePaneID === paneID &&
          dragState.sourceIndex === index;

        return (
          <div
            key={tabKey(tab)}
            data-tab-pane={paneID}
            data-tab-index={index}
            data-tab-kind={tab.kind}
            onPointerDown={(e) => handlePointerDown(e, index)}
            onPointerUp={(e) => handlePointerUp(e, index)}
            className={cn(
              "relative flex h-full shrink-0 cursor-default select-none items-center gap-1.5 border-r border-neutral-800 pl-3 pr-1.5 text-xs",
              isActive && isFocused
                ? "bg-neutral-900 text-neutral-200"
                : isActive
                  ? "bg-neutral-900 text-neutral-500"
                  : "text-neutral-500 hover:bg-neutral-800/30 hover:text-neutral-300",
              isBeingDragged && "opacity-30"
            )}
          >
            {tab.kind === "editor" ? (
              <FileTypeIcon path={tab.path} kind="file" className="pointer-events-none" />
            ) : tab.kind === "diff" ? (
              <GitCompare className="size-3.5 shrink-0 text-neutral-500" aria-hidden />
            ) : null}
            <span className="pointer-events-none max-w-[120px] truncate">
              {tabLabel(tab, slotsMap)}
            </span>

            {tab.kind === "editor" ? (
              <EditorTabCloseControl
                workspaceId={workspaceId}
                workspaceRoot={workspaceRoot}
                paneID={paneID}
                index={index}
                path={tab.path}
                label={tabLabel(tab, slotsMap)}
                isActive={isActive}
              />
            ) : tab.kind === "diff" ? (
              <div
                role="button"
                tabIndex={-1}
                aria-label={`Close ${tabLabel(tab, slotsMap)}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  removePaneTabByIndex(paneID, index);
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
                aria-label={`Close ${tabLabel(tab, slotsMap)}`}
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

            {isActive && isFocused && (
              <span className="pointer-events-none absolute inset-x-2 bottom-0 h-px bg-neutral-500" />
            )}
          </div>
        );
      })}
    </div>
  );
}
