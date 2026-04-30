import { memo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronRight } from "lucide-react";
import { ArrowTurnBackwardIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { cn } from "@/lib/shared/utils";
import {
  decorationForGitEntry,
  gitToneTextClass,
  statusTone,
} from "@/services/git/git-utils";
import { ScmStatusBadge } from "./scm-status-badge";
import {
  GIT_SECTION_STICKY_ROW_HEIGHT_PX,
  type DiscardEntryFn,
  type SelectGitEntryFn,
} from "@/services/git/git-types";
import type { ScmEntry } from "@/lib/shared/types";

type UnstagedChangesSectionProps = {
  unstagedList: ScmEntry[];
  changesOpen: boolean;
  setChangesOpen: (open: boolean) => void;
  pendingPaths: ReadonlySet<string>;
  stickyTop: number;
  stickyZIndex: number;
  selectedPaths: Set<string>;
  visiblePaths: string[];
  onOpenFile: (path: string) => void;
  onOpenReviewPath: (path: string) => void;
  onSelectEntry: SelectGitEntryFn;
  onDiscard: DiscardEntryFn;
  onStage: (entry: ScmEntry) => void;
  onDiscardAll: () => void;
  onStageAll: () => void;
};

type UnstagedRowProps = {
  entry: ScmEntry;
  selected: boolean;
  pending: boolean;
  visiblePaths: string[];
  onOpenFile: (path: string) => void;
  onOpenReviewPath: (path: string) => void;
  onSelectEntry: SelectGitEntryFn;
  onDiscard: DiscardEntryFn;
  onStage: (entry: ScmEntry) => void;
};

const UnstagedRow = memo(function UnstagedRow({
  entry,
  selected,
  pending,
  visiblePaths,
  onOpenFile,
  onOpenReviewPath,
  onSelectEntry,
  onDiscard,
  onStage,
}: UnstagedRowProps) {
  const tone = statusTone(entry);
  const decoration = decorationForGitEntry(entry);
  const pathParts = entry.path.split("/");
  const fileName = pathParts[pathParts.length - 1] ?? entry.path;
  const directoryPath = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : "";

  return (
    <li className={cn("group min-w-0 px-1", pending && "opacity-50")}>
      <div
        role="button"
        tabIndex={0}
        aria-selected={selected}
        className={cn(
          "flex h-7 min-w-0 max-w-full cursor-pointer items-center gap-1 overflow-hidden rounded-md px-1 hover:bg-[var(--theme-panel-hover)]",
          selected &&
            "bg-[var(--theme-panel-hover)] outline outline-1 outline-[var(--theme-border)]",
        )}
        onClick={(event) => {
          const selectionHandled = onSelectEntry(entry.path, visiblePaths, {
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
          });
          if (!selectionHandled) {
            onOpenReviewPath(entry.path);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpenReviewPath(entry.path);
          }
        }}
      >
        <FileTypeIcon path={entry.path} kind="file" className="shrink-0" />
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          <span className={cn("min-w-0 truncate text-[13px]", gitToneTextClass(tone))}>
            {fileName}
          </span>
          <span className="min-w-0 truncate text-[12px] text-[var(--theme-text-faint)]">
            {directoryPath || "."}
          </span>
        </div>
        <div
          className="mr-1 hidden shrink-0 items-center gap-0.5 group-hover:flex"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            title="Open file"
            aria-label="Open file"
            onClick={(event) => {
              event.stopPropagation();
              onOpenFile(entry.path);
            }}
          >
            <FileTypeIcon path={entry.path} kind="file" className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-warning)]"
            title={entry.untracked ? "Delete untracked" : "Discard changes"}
            aria-label={entry.untracked ? "Delete untracked" : "Discard changes"}
            onClick={(event) => {
              event.stopPropagation();
              onDiscard(entry);
            }}
          >
            <HugeiconsIcon icon={ArrowTurnBackwardIcon} strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
            title="Stage changes"
            aria-label="Stage changes"
            onClick={(event) => {
              event.stopPropagation();
              onStage(entry);
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={1.5} className="size-3.5" />
          </Button>
        </div>
        {decoration.badge ? (
          <ScmStatusBadge
            text={decoration.badge}
            tone={decoration.tone}
            className="shrink-0"
          />
        ) : null}
      </div>
    </li>
  );
});

export function UnstagedChangesSection({
  unstagedList,
  changesOpen,
  setChangesOpen,
  pendingPaths,
  stickyTop,
  stickyZIndex,
  selectedPaths,
  visiblePaths,
  onOpenFile,
  onOpenReviewPath,
  onSelectEntry,
  onDiscard,
  onStage,
  onDiscardAll,
  onStageAll,
}: UnstagedChangesSectionProps) {
  if (unstagedList.length === 0) return null;
  const stageLabel = "Stage all changes";
  const discardLabel = "Discard all files";
  const allPending = pendingPaths.size > 0;

  return (
    <section>
      <div
        role="button"
        tabIndex={0}
        className="group sticky flex w-full cursor-pointer items-center justify-start gap-1 rounded-none border-0 bg-[var(--theme-bg)] bg-clip-border py-1 pl-2 pr-1 text-sm font-normal text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
        style={{
          top: stickyTop,
          zIndex: stickyZIndex,
          minHeight: GIT_SECTION_STICKY_ROW_HEIGHT_PX,
          height: GIT_SECTION_STICKY_ROW_HEIGHT_PX,
        }}
        aria-expanded={changesOpen}
        onClick={() => setChangesOpen(!changesOpen)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setChangesOpen(!changesOpen);
          }
        }}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            changesOpen && "rotate-90",
          )}
        />
        <span className="text-[11px] font-medium uppercase tracking-wide">Changes</span>
        <span
          className="ml-auto flex w-14 items-center justify-end gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={allPending}
            title={discardLabel}
            aria-label={discardLabel}
            onClick={(event) => {
              event.stopPropagation();
              onDiscardAll();
            }}
          >
            <HugeiconsIcon icon={ArrowTurnBackwardIcon} strokeWidth={1.5} className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={allPending}
            title={stageLabel}
            aria-label={stageLabel}
            onClick={(event) => {
              event.stopPropagation();
              onStageAll();
            }}
          >
            <HugeiconsIcon icon={PlusSignIcon} strokeWidth={1.5} className="size-3.5" />
          </Button>
        </span>
        <span className="flex items-center gap-1">
          <Badge
            variant={"outline"}
            className="p-1.5 font-mono text-xs text-[var(--theme-text-subtle)]"
          >
            {unstagedList.length}
          </Badge>
        </span>
      </div>
      {changesOpen ? (
        <ul className="flex flex-col">
          {unstagedList.map((entry) => (
            <UnstagedRow
              key={`u:${entry.path}`}
              entry={entry}
              selected={selectedPaths.has(entry.path)}
              pending={pendingPaths.has(entry.path)}
              visiblePaths={visiblePaths}
              onOpenFile={onOpenFile}
              onOpenReviewPath={onOpenReviewPath}
              onSelectEntry={onSelectEntry}
              onDiscard={onDiscard}
              onStage={onStage}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
