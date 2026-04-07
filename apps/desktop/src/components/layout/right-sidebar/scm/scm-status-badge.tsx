import { cn } from "@/lib/shared/utils";

type ScmStatusBadgeProps = {
  text: string;
  className?: string;
};

export function ScmStatusBadge({ text, className }: ScmStatusBadgeProps) {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1 font-mono text-[10px] font-medium text-[var(--theme-text-muted)]",
        className,
      )}
    >
      {text}
    </span>
  );
}
