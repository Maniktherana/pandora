import { cn } from "@/lib/shared/utils";
import type { WorkspaceStatus } from "@/lib/shared/types";

type StatusDotProps = {
  status: WorkspaceStatus;
};

export function StatusDot({ status }: StatusDotProps) {
  const colors = {
    ready: "bg-[var(--theme-success)]",
    creating: "bg-[var(--theme-warning)] animate-pulse",
    failed: "bg-[var(--theme-error)]",
    deleting: "bg-[var(--theme-text-faint)]",
    archived: "bg-[var(--theme-text-faint)]",
  } as const;

  return <div className={cn("w-2 h-2 rounded-full shrink-0", colors[status])} />;
}
