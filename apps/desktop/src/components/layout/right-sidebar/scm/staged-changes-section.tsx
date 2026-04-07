import { ChevronRight, FileText, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { cn } from "@/lib/shared/utils";
import {
  scmToneTextClass,
  scmUnstage,
  statusTone,
} from "@/components/layout/right-sidebar/scm/scm.utils";
import { ScmStatusBadge } from "./scm-status-badge";
import type { OpenDiffFn, RunScmActionFn, ScmStatusEntry } from "./scm.types";

type StagedChangesSectionProps = {
  stagedList: ScmStatusEntry[];
  stagedOpen: boolean;
  setStagedOpen: (open: boolean) => void;
  busy: boolean;
  workspaceRoot: string;
  onOpenDiff: OpenDiffFn;
  onOpenFile: (path: string) => void;
  run: RunScmActionFn;
};

export function StagedChangesSection({
  stagedList,
  stagedOpen,
  setStagedOpen,
  busy,
  workspaceRoot,
  onOpenDiff,
  onOpenFile,
  run,
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
            className="group h-auto min-h-0 w-full justify-start gap-1 rounded-none py-1 pl-2 pr-1 font-normal text-[var(--theme-text-muted)] hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)] data-[panel-open]:bg-[var(--theme-panel-hover)]"
          >
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[panel-open]:rotate-90" />
            <span className="text-[11px] font-medium uppercase tracking-wide">
              Staged ({stagedList.length})
            </span>
          </Button>
        }
      />
      <CollapsibleContent>
        <ul className="flex flex-col gap-0.5 pb-1">
          {stagedList.map((entry) => {
            const tone = statusTone(entry);
            return (
              <li
                key={`s:${entry.path}`}
                className="flex min-w-0 items-center gap-0.5 border-b border-[var(--theme-border)]/60 py-0.5 pl-1 pr-1 last:border-b-0"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0 text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                  title="Open staged diff"
                  disabled={busy}
                  onClick={() => onOpenDiff(entry.path, "staged")}
                >
                  <FileTypeIcon
                    path={entry.path}
                    kind="file"
                    className="pointer-events-none"
                  />
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1">
                    {entry.stagedKind ? (
                      <ScmStatusBadge
                        text={entry.stagedKind}
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
                      onClick={() => onOpenDiff(entry.path, "staged")}
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
                    title="Unstage"
                    disabled={busy}
                    onClick={() => void run(() => scmUnstage(workspaceRoot, [entry.path]))}
                  >
                    <Minus className="size-3.5" />
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

