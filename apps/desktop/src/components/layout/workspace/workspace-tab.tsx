import { GitCompare, X } from "lucide-react";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import TerminalIdentityIcon from "@/components/terminal/terminal-identity-icon";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { useEditorStore } from "@/state/editor-store";
import type {
  PaneTab,
  SessionState,
  SlotState,
  TerminalDisplayState,
} from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { terminalDisplayForSlot } from "@/lib/terminal/terminal-identity";
import { scmToneTextClass, statusTone } from "@/components/layout/right-sidebar/scm/scm.utils";
import type { ScmStatusEntry } from "@/components/layout/right-sidebar/scm/scm.types";

type WorkspaceTabProps = {
  tab: PaneTab;
  index: number;
  paneID: string;
  workspaceId: string;
  workspaceRoot: string;
  selectedIndex: number;
  isFocused: boolean;
  isLast: boolean;
  isBeingDragged: boolean;
  scmEntry?: ScmStatusEntry;
  slotsMap: Record<string, SlotState | undefined>;
  sessionsMap: Record<string, SessionState | undefined>;
  displayMap: Record<string, TerminalDisplayState>;
  onPointerDown: (event: React.PointerEvent, index: number) => void;
  onPointerUp: (event: React.PointerEvent, index: number) => void;
  onCloseDiffTab: (index: number) => void;
  onCloseTerminalTab: (index: number) => void;
};

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

export function WorkspaceTab(props: WorkspaceTabProps) {
  const {
    tab,
    index,
    paneID,
    workspaceId,
    workspaceRoot,
    selectedIndex,
    isFocused,
    isLast,
    isBeingDragged,
    scmEntry,
    slotsMap,
    sessionsMap,
    displayMap,
    onPointerDown,
    onPointerUp,
    onCloseDiffTab,
    onCloseTerminalTab,
  } = props;

  const isActive = index === selectedIndex;
  const terminalDisplay =
    tab.kind === "terminal" ? terminalTabDisplay(tab, slotsMap, sessionsMap, displayMap) : null;
  const toneClass = scmEntry ? scmToneTextClass(statusTone(scmEntry)) : "";
  const label = tabLabel(tab, slotsMap, sessionsMap, displayMap);

  return (
    <div
      data-tab-pane={paneID}
      data-tab-index={index}
      data-tab-kind={tab.kind}
      data-workspace-id={workspaceId}
      onPointerDown={(e) => onPointerDown(e, index)}
      onPointerUp={(e) => onPointerUp(e, index)}
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
      {tab.kind === "editor" ? (
        <FileTypeIcon path={tab.path} kind="file" className="pointer-events-none" />
      ) : tab.kind === "diff" ? (
        <GitCompare className={cn("size-3.5 shrink-0", toneClass || "text-neutral-500")} aria-hidden />
      ) : terminalDisplay ? (
        <TerminalIdentityIcon identity={terminalDisplay} className="size-3.5 pointer-events-none" />
      ) : null}
      <span className={cn("pointer-events-none max-w-[120px] truncate", toneClass)}>{label}</span>

      {tab.kind === "editor" ? (
        <EditorTabCloseControl
          workspaceId={workspaceId}
          workspaceRoot={workspaceRoot}
          paneID={paneID}
          index={index}
          path={tab.path}
          label={label}
          isActive={isActive}
        />
      ) : tab.kind === "diff" ? (
        <div
          role="button"
          tabIndex={-1}
          aria-label={`Close ${label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onCloseDiffTab(index);
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
          aria-label={`Close ${label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onCloseTerminalTab(index);
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
}
