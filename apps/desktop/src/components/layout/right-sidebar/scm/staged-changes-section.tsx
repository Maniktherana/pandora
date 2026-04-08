import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronRight } from "lucide-react";
import { FilePlusIcon, MinusSignIcon } from "@hugeicons/core-free-icons";
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
import type { OpenDiffFn, ScmStatusEntry } from "./scm.types";

type StagedChangesSectionProps = {
  stagedList: ScmStatusEntry[];
  stagedOpen: boolean;
  setStagedOpen: (open: boolean) => void;
  busy: boolean;
  onOpenDiff: OpenDiffFn;
  onUnstage: (path: string) => void;
  onViewAll: () => void;
  onUnstageAll: () => void;
};

export function StagedChangesSection({
  stagedList,
  stagedOpen,
  setStagedOpen,
  busy,
  onOpenDiff,
  onUnstage,
  onViewAll,
  onUnstageAll,
}: StagedChangesSectionProps) {
  if (stagedList.length === 0) return null;

  return (
    <Collapsible open={stagedOpen} onOpenChange={setStagedOpen}>
      <CollapsibleTrigger
        nativeButton={false}
        render={
          <Button
            variant="ghost"
            size="sm"
            className="group h-auto min-h-0 w-full justify-start gap-1 rounded-none py-1 pl-2 pr-1 font-normal text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)] aria-expanded:bg-transparent aria-expanded:text-[var(--theme-text-muted)]"
          >
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
            <span className="text-[11px] font-medium uppercase tracking-wide">Staged</span>
            <span className="ml-auto flex w-14 items-center justify-end gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
              <Tooltip>
                <TooltipTrigger
                  render={<Button type="button" variant="ghost" size="icon-xs" disabled={busy} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onViewAll();
                  }}
                >
                  <HugeiconsIcon icon={FilePlusIcon} strokeWidth={1.5} className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>View all changes</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={<Button type="button" variant="ghost" size="icon-xs" disabled={busy} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onUnstageAll();
                  }}
                >
                  <HugeiconsIcon icon={MinusSignIcon} strokeWidth={1.5} className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>Unstage all items</TooltipContent>
              </Tooltip>
            </span>
            <span className="flex items-center gap-1">
            <Badge variant={"outline"} className="p-1.5 font-mono text-xs text-[var(--theme-text-subtle)]">
                {stagedList.length}
              </Badge>
            </span>
          </Button>
        }
      />
      <CollapsibleContent>
        <TooltipProvider>
          <ul className="flex flex-col gap-0.5 pb-1">
            {stagedList.map((entry) => {
              const tone = statusTone(entry);
              const decoration = decorationForScmEntry(entry);
              const pathParts = entry.path.split("/");
              const fileName = pathParts[pathParts.length - 1] ?? entry.path;
              const directoryPath = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : "";
              return (
                <li key={`s:${entry.path}`} className="group py-0.5 pl-1 pr-1">
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex h-7 min-w-0 cursor-pointer items-center gap-1 rounded-md px-1 hover:bg-[var(--theme-panel-hover)]"
                    onClick={() => onOpenDiff(entry.path, "staged")}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenDiff(entry.path, "staged");
                      }
                    }}
                  >
                    <FileTypeIcon path={entry.path} kind="file" className="shrink-0" />
                    <div className="min-w-0 flex flex-1 items-center gap-1">
                      <span
                        className={cn("shrink-0 text-[12px]", scmToneTextClass(tone))}
                      >
                        {fileName}
                      </span>
                      <span className="truncate text-[11px] text-[var(--theme-text-faint)]">
                        {directoryPath || "."}
                      </span>
                    </div>
                    <div className="mr-1 hidden shrink-0 items-center gap-0.5 group-hover:flex">
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
                            onOpenDiff(entry.path, "staged");
                          }}
                        >
                          <HugeiconsIcon icon={FilePlusIcon} strokeWidth={1.5} className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>View changes</TooltipContent>
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
                            onUnstage(entry.path);
                          }}
                        >
                          <HugeiconsIcon icon={MinusSignIcon} strokeWidth={1.5} className="size-3.5" />
                        </TooltipTrigger>
                        <TooltipContent>Unstage changes</TooltipContent>
                      </Tooltip>
                    </div>
                    {decoration.badge ? (
                      <ScmStatusBadge text={decoration.badge} tone={decoration.tone} className="shrink-0" />
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
