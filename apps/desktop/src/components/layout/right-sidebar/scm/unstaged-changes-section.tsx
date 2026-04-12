import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronRight } from "lucide-react";
import { ArrowTurnBackwardIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { cn } from "@/lib/shared/utils";
import {
  decorationForScmEntry,
  scmToneTextClass,
  statusTone,
} from "@/components/layout/right-sidebar/scm/scm.utils";
import { ScmStatusBadge } from "./scm-status-badge";
import {
  SCM_SECTION_STICKY_ROW_HEIGHT_PX,
  type DiscardEntryFn,
  type SelectScmEntryFn,
  type ScmStatusEntry,
} from "./scm.types";

type UnstagedChangesSectionProps = {
  unstagedList: ScmStatusEntry[];
  changesOpen: boolean;
  setChangesOpen: (open: boolean) => void;
  busy: boolean;
  stickyTop: number;
  stickyZIndex: number;
  selectedPaths: Set<string>;
  onOpenFile: (path: string) => void;
  onOpenReviewPath: (path: string) => void;
  onSelectEntry: SelectScmEntryFn;
  onDiscard: DiscardEntryFn;
  onStage: (entry: ScmStatusEntry) => void;
  onDiscardAll: () => void;
  onStageAll: () => void;
};

export function UnstagedChangesSection({
  unstagedList,
  changesOpen,
  setChangesOpen,
  busy,
  stickyTop,
  stickyZIndex,
  selectedPaths,
  onOpenFile,
  onOpenReviewPath,
  onSelectEntry,
  onDiscard,
  onStage,
  onDiscardAll,
  onStageAll,
}: UnstagedChangesSectionProps) {
  if (unstagedList.length === 0) return null;
  const visiblePaths = unstagedList.map((entry) => entry.path);
  const stageLabel = "Stage all changes";
  const discardLabel = "Discard all files";

  return (
    <Collapsible open={changesOpen} onOpenChange={setChangesOpen}>
      <CollapsibleTrigger
        nativeButton={false}
        render={
          <Button
            render={<div />}
            variant="ghost"
            size="sm"
            className="group sticky w-full justify-start gap-1 rounded-none border-0 bg-[var(--theme-bg)] bg-clip-border py-1 pl-2 pr-1 font-normal text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)] aria-expanded:bg-[var(--theme-bg)] aria-expanded:text-[var(--theme-text-muted)]"
            style={{
              top: stickyTop,
              zIndex: stickyZIndex,
              minHeight: SCM_SECTION_STICKY_ROW_HEIGHT_PX,
              height: SCM_SECTION_STICKY_ROW_HEIGHT_PX,
            }}
          >
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
            <span className="text-[11px] font-medium uppercase tracking-wide">Changes</span>
            <span
              className="ml-auto flex w-14 items-center justify-end gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Tooltip>
                <TooltipTrigger
                  render={<Button type="button" variant="ghost" size="icon-xs" disabled={busy} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDiscardAll();
                  }}
                >
                  <HugeiconsIcon
                    icon={ArrowTurnBackwardIcon}
                    strokeWidth={1.5}
                    className="size-3.5"
                  />
                </TooltipTrigger>
                <TooltipContent>{discardLabel}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={<Button type="button" variant="ghost" size="icon-xs" disabled={busy} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onStageAll();
                  }}
                >
                  <HugeiconsIcon icon={PlusSignIcon} strokeWidth={1.5} className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{stageLabel}</TooltipContent>
              </Tooltip>
            </span>
            <span className="flex items-center gap-1">
              <Badge
                variant={"outline"}
                className="p-1.5 font-mono text-xs text-[var(--theme-text-subtle)]"
              >
                {unstagedList.length}
              </Badge>
            </span>
          </Button>
        }
      />
      <CollapsibleContent>
        <TooltipProvider>
          <ul className="flex flex-col">
            {unstagedList.map((entry) => {
              const tone = statusTone(entry);
              const decoration = decorationForScmEntry(entry);
              const selected = selectedPaths.has(entry.path);
              const pathParts = entry.path.split("/");
              const fileName = pathParts[pathParts.length - 1] ?? entry.path;
              const directoryPath = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : "";
              return (
                <li key={`u:${entry.path}`} className="group px-1">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-selected={selected}
                    className={cn(
                      "flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-md px-1 hover:bg-[var(--theme-panel-hover)]",
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
                    <div className="min-w-0 flex flex-1 items-center gap-1">
                      <span className={cn("shrink-0 text-[13px]", scmToneTextClass(tone))}>
                        {fileName}
                      </span>
                      <span className="truncate text-[12px] text-[var(--theme-text-faint)]">
                        {directoryPath || "."}
                      </span>
                    </div>
                    <div
                      className="mr-1 hidden shrink-0 items-center gap-0.5 group-hover:flex"
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button type="button" variant="ghost" size="icon-xs" disabled={busy} />
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenFile(entry.path);
                          }}
                        >
                          <FileTypeIcon path={entry.path} kind="file" className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>Open file</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-warning)]"
                              disabled={busy}
                            />
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            onDiscard(entry);
                          }}
                        >
                          <HugeiconsIcon
                            icon={ArrowTurnBackwardIcon}
                            strokeWidth={1.5}
                            className="size-3.5"
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          {entry.untracked ? "Delete untracked" : "Discard changes"}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
                              disabled={busy}
                            />
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            onStage(entry);
                          }}
                        >
                          <HugeiconsIcon
                            icon={PlusSignIcon}
                            strokeWidth={1.5}
                            className="size-3.5"
                          />
                        </TooltipTrigger>
                        <TooltipContent>Stage changes</TooltipContent>
                      </Tooltip>
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
            })}
          </ul>
        </TooltipProvider>
      </CollapsibleContent>
    </Collapsible>
  );
}
