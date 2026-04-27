import { X } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitCompareIcon } from "@hugeicons/core-free-icons";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import TerminalIdentityIcon from "@/components/terminal/terminal-identity-icon";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { useEditorStore } from "@/state/editor-store";
import type {
  PaneTab,
  SessionState,
  SlotState,
  TerminalAgentStatus,
  TerminalDisplayState,
} from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";
import { terminalDisplayForSlot } from "@/lib/terminal/terminal-identity";
import {
  decorationForScmEntry,
  scmToneTextClass,
  statusTone,
} from "@/components/layout/right-sidebar/scm/scm.utils";
import { ScmStatusBadge } from "@/components/layout/right-sidebar/scm/scm-status-badge";
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
  scmEntry?: ScmStatusEntry | undefined;
  slotsMap: Record<string, SlotState | undefined>;
  sessionsMap: Record<string, SessionState | undefined>;
  displayMap: Record<string, TerminalDisplayState>;
  terminalAgentStatus: TerminalAgentStatus;
  onPointerDown: (event: React.PointerEvent, index: number) => void;
  onPointerUp: (event: React.PointerEvent, index: number) => void;
  onCloseDiffTab: (index: number) => void;
  onCloseTerminalTab: (index: number) => void;
};

function TerminalAgentStatusIndicator({ status }: { status: TerminalAgentStatus }) {
  if (status === "idle") return null;
  return (
    <span
      aria-hidden
      className={cn("h-2 w-2 shrink-0 rounded-full", {
        "animate-pulse bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.45)]": status === "working",
        "animate-pulse bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]": status === "permission",
        "bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.45)]": status === "review",
      })}
    />
  );
}

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
        "flex h-4 w-4 items-center justify-center rounded-sm opacity-0 transition-[opacity,color,background-color] group-hover/tab:opacity-100",
        {
          "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100": isActive,
          "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200": !isActive,
        },
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
    terminalAgentStatus,
    onPointerDown,
    onPointerUp,
    onCloseDiffTab,
    onCloseTerminalTab,
  } = props;

  const isActive = index === selectedIndex;
  const isTerminal = tab.kind === "terminal";
  const terminalDisplay =
    tab.kind === "terminal" ? terminalTabDisplay(tab, slotsMap, sessionsMap, displayMap) : null;
  const toneClass = scmEntry ? scmToneTextClass(statusTone(scmEntry)) : "";
  const label = tabLabel(tab, slotsMap, sessionsMap, displayMap);
  const scmDecoration =
    tab.kind === "editor" || tab.kind === "diff"
      ? scmEntry
        ? decorationForScmEntry(scmEntry)
        : null
      : null;

  return (
    <div
      data-tab-pane={paneID}
      data-tab-index={index}
      data-tab-kind={tab.kind}
      data-workspace-id={workspaceId}
      onPointerDown={(e) => onPointerDown(e, index)}
      onPointerUp={(e) => onPointerUp(e, index)}
      className={cn(
        "group/tab relative flex h-full shrink-0 cursor-default select-none items-center gap-1.5 pl-3 pr-1.5 text-xs",
        "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-20 after:h-[2px]",
        {
          "border-r border-neutral-800": !isLast,
          "bg-[var(--theme-terminal-bg)] text-neutral-200 after:content-['']":
            isActive && isTerminal,
          "bg-neutral-900 text-neutral-200 after:content-['']": isActive && !isTerminal,
          "after:bg-neutral-200": isActive && isFocused,
          "after:bg-neutral-800": isActive && !isFocused,
          "text-neutral-500 hover:bg-neutral-800/30 hover:text-neutral-300": !isActive,
          "opacity-30": isBeingDragged,
        },
      )}
    >
      {tab.kind === "editor" || tab.kind === "diff" ? (
        <FileTypeIcon path={tab.path} kind="file" className="pointer-events-none" />
      ) : tab.kind === "review" ? (
        <HugeiconsIcon
          icon={GitCompareIcon}
          strokeWidth={1.5}
          className={cn("size-3.5 shrink-0", {
            "text-neutral-200": isActive,
            "text-neutral-500": !isActive,
          })}
        />
      ) : terminalDisplay ? (
        <TerminalIdentityIcon identity={terminalDisplay} className="size-3.5 pointer-events-none" />
      ) : null}
      <span className={cn("pointer-events-none min-w-0 flex-1 truncate", toneClass)}>{label}</span>
      {scmDecoration?.badge && (
        <ScmStatusBadge
          text={scmDecoration.badge}
          tone={scmDecoration.tone}
          className="pointer-events-none"
        />
      )}
      {tab.kind === "terminal" ? (
        <TerminalAgentStatusIndicator status={terminalAgentStatus} />
      ) : null}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-0 top-0 h-full w-14 opacity-0 transition-opacity group-hover/tab:opacity-100",
          "bg-gradient-to-l to-transparent",
          {
            "from-[var(--theme-terminal-bg)]": isActive && isTerminal,
            "from-neutral-900": isActive && !isTerminal,
            "from-neutral-800/30": !isActive,
          },
        )}
      />

      <div className="relative z-10 ml-1 flex h-full items-center pl-1">
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
        ) : tab.kind === "diff" || tab.kind === "review" ? (
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
              "flex h-4 w-4 items-center justify-center rounded-sm opacity-0 transition-[opacity,color,background-color] group-hover/tab:opacity-100",
              {
                "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100": isActive,
                "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200": !isActive,
              },
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
              "flex h-4 w-4 items-center justify-center rounded-sm opacity-0 transition-[opacity,color,background-color] group-hover/tab:opacity-100",
              {
                "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100": isActive,
                "text-neutral-600 hover:bg-neutral-800 hover:text-neutral-200": !isActive,
              },
            )}
          >
            <X className="h-3 w-3" aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}
