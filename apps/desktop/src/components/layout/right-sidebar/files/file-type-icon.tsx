import spriteUrl from "@/assets/file-icons-sprite.svg?url";
import { chooseIconName } from "@/components/layout/right-sidebar/files/files.utils";
import { cn } from "@/lib/shared/utils";

export function FileTypeIcon({
  path,
  kind,
  expanded = false,
  className,
}: {
  path: string;
  kind: "file" | "directory";
  expanded?: boolean;
  className?: string;
}) {
  const symbolId = chooseIconName(path, kind === "directory" ? "directory" : "file", expanded);
  return (
    <svg
      className={cn("size-4 shrink-0 overflow-visible", className)}
      width={16}
      height={16}
      aria-hidden
    >
      <use href={`${spriteUrl}#${symbolId}`} width="100%" height="100%" />
    </svg>
  );
}
