import { clsx } from "clsx";
import type { TreeGitTone } from "@/lib/services/git/git.types";
import { gitToneTextClass } from "@/lib/services/git/utils";

type ScmStatusBadgeProps = {
  text: string;
  tone: TreeGitTone;
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
        className={clsx(
          "size-1.5 shrink-0 rounded-full bg-current",
          gitToneTextClass(tone, dimmed),
          className,
        )}
      />
    );
  }

  return (
    <span
      className={clsx(
        "shrink-0 font-mono text-xs font-semibold leading-none",
        gitToneTextClass(tone, dimmed),
        className,
      )}
    >
      {text}
    </span>
  );
}
