import { cn } from "@/lib/shared/utils";
import type { TreeScmTone } from "./scm.types";
import { scmToneTextClass } from "./scm.utils";

type ScmStatusBadgeProps = {
  text: string;
  tone: TreeScmTone;
  dimmed?: boolean;
  className?: string;
};

export function ScmStatusBadge({ text, tone, dimmed = false, className }: ScmStatusBadgeProps) {
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-xs font-semibold leading-none",
        scmToneTextClass(tone, dimmed),
        className,
      )}
    >
      {text}
    </span>
  );
}
