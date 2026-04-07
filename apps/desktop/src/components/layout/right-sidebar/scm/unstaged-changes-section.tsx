import { ChevronRight, FileText, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { cn } from "@/lib/shared/utils";
import {
  scmStage,
  scmToneTextClass,
  statusTone,
} from "@/components/layout/right-sidebar/scm/scm.utils";
import { ScmStatusBadge } from "./scm-status-badge";
import type {
  DiscardEntryFn,
  OpenDiffFn,
  RunScmActionFn,
  ScmStatusEntry,
} from "./scm.types";

type UnstagedChangesSectionProps = {
  unstagedList: ScmStatusEntry[];
  changesOpen: boolean;
  setChangesOpen: (open: boolean) => void;
  busy: boolean;
  workspaceRoot: string;
  onOpenDiff: OpenDiffFn;
  onOpenFile: (path: string) => void;
  onDiscard: DiscardEntryFn;
  run: RunScmActionFn;
};

export function UnstagedChangesSection({
  unstagedList,
  changesOpen,
  setChangesOpen,
  busy,
  workspaceRoot,
  onOpenDiff,
  onOpenFile,
  onDiscard,
  run,
}: UnstagedChangesSectionProps) {
  if (unstagedList.length === 0) return null;

  return (
    <Collapsible open={changesOpen} onOpenChange={setChangesOpen}>
      <CollapsibleTrigger
        nativeButton={false}
        render={
          <Button
            variant="ghost"
            size="sm"
            className="group h-auto min-h-0 w-full justify-start gap-1 rounded-none py-1 pl-2 pr-1 font-normal text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)] data-[panel-open]:bg-[var(--theme-panel-hover)]"
          >
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
            <span className="text-[11px] font-medium uppercase tracking-wide">
              Changes ({unstagedList.length})
            </span>
          </Button>
        }
      />
      <CollapsibleContent>
        <ul className="flex flex-col gap-0.5 pb-1">
          {unstagedList.map((entry) => {
            const tone = statusTone(entry);
            return (
              <li
                key={`u:${entry.path}`}
                className="flex min-w-0 items-center gap-0.5 border-b border-[var(--theme-border)]/60 py-0.5 pl-1 pr-1 last:border-b-0"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                  title="Open diff (working tree)"
                  disabled={busy}
                  onClick={() => onOpenDiff(entry.path, "working")}
                >
                  <FileTypeIcon
                    path={entry.path}
                    kind="file"
                    className="pointer-events-none"
                  />
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1">
                    {entry.untracked ? (
                      <ScmStatusBadge
                        text="?"
                        className={cn("bg-transparent", scmToneTextClass("added"))}
                      />
                    ) : entry.worktreeKind ? (
                      <ScmStatusBadge
                        text={entry.worktreeKind}
                        className={cn("bg-transparent", scmToneTextClass(tone))}
                      />
                    ) : null}
                    <button
                      type="button"
                      className={cn(
                        "min-w-0 truncate text-left font-mono text-[11px] hover:opacity-80 hover:underline",
                        scmToneTextClass(tone)
                      )}
                      title={entry.path}
                      disabled={busy}
                      onClick={() => onOpenDiff(entry.path, "working")}
                    >
                      {entry.path}
                    </button>
                  </div>
                  {entry.origPath ? (
                    <div
                      className="truncate pl-1 font-mono text-[10px] text-[var(--theme-text-faint)]"
                      title={entry.origPath}
                    >
                      ← {entry.origPath}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
                    title="Open file"
                    disabled={busy}
                    onClick={() => onOpenFile(entry.path)}
                  >
                    <FileText className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-[var(--theme-text-subtle)] hover:text-[var(--theme-text)]"
                    title="Stage"
                    disabled={busy}
                    onClick={() => void run(() => scmStage(workspaceRoot, [entry.path]))}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-[var(--theme-text-subtle)] hover:text-[var(--theme-warning)]"
                    title={entry.untracked ? "Delete untracked" : "Discard changes"}
                    disabled={busy}
                    onClick={() => onDiscard(entry)}
                  >
                    {entry.untracked ? (
                      <Trash2 className="size-3.5" />
                    ) : (
                      <RotateCcw className="size-3.5" />
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

