import { cn } from "@/lib/shared/utils";
import type { TreeScmTone } from "./scm.types";
import { scmToneTextClass } from "./scm.utils";

type ScmStatusBadgeProps = {
  text: string;
  tone: TreeScmTone;
  dimmed?: boolean;
  className?: string;
  variant?: "text" | "dot";
};

export function ScmStatusBadge({
  text,
  tone,
  dimmed = false,
  className,
  variant = "text",
}: ScmStatusBadgeProps) {
  if (variant === "dot") {
    return (
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-current",
          scmToneTextClass(tone, dimmed),
          className,
        )}
      />
    );
  }

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
