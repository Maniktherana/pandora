import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronRight } from "lucide-react";
import { MinusSignIcon } from "@hugeicons/core-free-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { cn } from "@/lib/shared/utils";
import {
  decorationForScmEntry,
  scmToneTextClass,
  statusTone,
} from "@/services/scm/scm-utils";
import { ScmStatusBadge } from "./scm-status-badge";
import {
  SCM_SECTION_STICKY_ROW_HEIGHT_PX,
  type SelectScmEntryFn,
} from "@/services/scm/scm-types";
import type { ScmEntry } from "@/lib/shared/types";

type StagedChangesSectionProps = {
  stagedList: ScmEntry[];
  stagedOpen: boolean;
  setStagedOpen: (open: boolean) => void;
  busy: boolean;
  stickyTop: number;
  stickyZIndex: number;
  selectedPaths: Set<string>;
  onOpenFile: (path: string) => void;
  onOpenReviewPath: (path: string) => void;
  onSelectEntry: SelectScmEntryFn;
  onUnstage: (path: string) => void;
  onUnstageAll: () => void;
};

export function StagedChangesSection({
  stagedList,
  stagedOpen,
  setStagedOpen,
  busy,
  stickyTop,
  stickyZIndex,
  selectedPaths,
  onOpenFile,
  onOpenReviewPath,
  onSelectEntry,
  onUnstage,
  onUnstageAll,
}: StagedChangesSectionProps) {
  if (stagedList.length === 0) return null;
  const visiblePaths = stagedList.map((entry) => entry.path);
  const unstageLabel = "Unstage all items";

  return (
    <section>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="group sticky w-full justify-start gap-1 rounded-none border-0 bg-[var(--theme-bg)] bg-clip-border py-1 pl-2 pr-1 font-normal text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]"
        style={{
          top: stickyTop,
          zIndex: stickyZIndex,
          minHeight: SCM_SECTION_STICKY_ROW_HEIGHT_PX,
          height: SCM_SECTION_STICKY_ROW_HEIGHT_PX,
        }}
        aria-expanded={stagedOpen}
        onClick={() => setStagedOpen(!stagedOpen)}
      >
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                stagedOpen && "rotate-90",
              )}
            />
            <span className="text-[11px] font-medium uppercase tracking-wide">Staged</span>
            <span
              className="ml-auto flex w-8 items-center justify-end gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={busy}
                title={unstageLabel}
                aria-label={unstageLabel}
                onClick={(event) => {
                  event.stopPropagation();
                  onUnstageAll();
                }}
              >
                <HugeiconsIcon icon={MinusSignIcon} strokeWidth={1.5} className="size-3.5" />
              </Button>
            </span>
            <span className="flex items-center gap-1">
              <Badge
                variant={"outline"}
                className="p-1.5 font-mono text-xs text-[var(--theme-text-subtle)]"
              >
                {stagedList.length}
              </Badge>
            </span>
      </Button>
      {stagedOpen ? (
        <ul className="flex flex-col">
          {stagedList.map((entry) => {
            const tone = statusTone(entry);
            const decoration = decorationForScmEntry(entry);
            const selected = selectedPaths.has(entry.path);
            const pathParts = entry.path.split("/");
            const fileName = pathParts[pathParts.length - 1] ?? entry.path;
            const directoryPath = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : "";
            return (
              <li key={`s:${entry.path}`} className="group min-w-0 px-1">
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
                    <span className={cn("min-w-0 truncate text-[12px]", scmToneTextClass(tone))}>
                      {fileName}
                    </span>
                    <span className="min-w-0 truncate text-[11px] text-[var(--theme-text-faint)]">
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
                      disabled={busy}
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
                      className="text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
                      disabled={busy}
                      title="Unstage changes"
                      aria-label="Unstage changes"
                      onClick={(event) => {
                        event.stopPropagation();
                        onUnstage(entry.path);
                      }}
                    >
                      <HugeiconsIcon
                        icon={MinusSignIcon}
                        strokeWidth={1.5}
                        className="size-3.5"
                      />
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
          })}
        </ul>
      ) : null}
    </section>
  );
}
