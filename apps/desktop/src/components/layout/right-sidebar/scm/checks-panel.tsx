import { Circle, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useCheckRunsQuery } from "./scm-queries";
import DotGridLoader from "@/components/dot-grid-loader";
import type { CheckRun } from "./scm.types";

type ChecksPanelProps = {
  worktreePath: string;
};

function statusIcon(run: CheckRun) {
  const conclusion = run.conclusion;
  const status = run.status;

  if (conclusion === "success") {
    return <CheckCircle2 className="size-3.5 shrink-0 text-[var(--theme-scm-added)]" />;
  }
  if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled") {
    return <XCircle className="size-3.5 shrink-0 text-[var(--theme-scm-deleted)]" />;
  }
  if (status === "in_progress") {
    return <Clock className="size-3.5 shrink-0 text-yellow-500" />;
  }
  if (status === "queued" || status === "pending") {
    return <Circle className="size-3.5 shrink-0 text-[var(--theme-text-faint)]" />;
  }
  // neutral / skipped / other
  if (conclusion === "neutral" || conclusion === "skipped") {
    return <Circle className="size-3.5 shrink-0 text-[var(--theme-text-faint)]" />;
  }
  return <Circle className="size-3.5 shrink-0 text-[var(--theme-text-faint)]" />;
}

export function ChecksPanel({ worktreePath }: ChecksPanelProps) {
  const { data: checkRuns, isLoading, error } = useCheckRunsQuery(worktreePath);

  if (isLoading && !checkRuns) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4">
        <div className="flex flex-col items-center text-center text-[var(--theme-text-faint)]">
          <DotGridLoader
            variant="default"
            gridSize={5}
            sizeClassName="h-8 w-8"
            className="opacity-90"
          />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-2 py-2 text-xs text-[var(--theme-text-subtle)]">Failed to load checks</div>
    );
  }

  if (!checkRuns || checkRuns.length === 0) {
    return <div className="px-2 py-2 text-xs text-[var(--theme-text-faint)]">No checks found</div>;
  }

  return (
    <div className="flex flex-col gap-0.5 px-1 py-1">
      {checkRuns.map((run, index) => (
        <button
          type="button"
          key={`${run.name}-${index}`}
          className="flex items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] text-[var(--theme-text-subtle)] hover:bg-[var(--theme-panel-elevated)] hover:text-[var(--theme-text)]"
          onClick={() => {
            if (run.htmlUrl) {
              window.open(run.htmlUrl, "_blank");
            }
          }}
        >
          {statusIcon(run)}
          <span className="truncate">{run.name}</span>
          {run.conclusion && (
            <span className="ml-auto shrink-0 text-[10px] text-[var(--theme-text-faint)]">
              {run.conclusion}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
