import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
  getBuiltInFileIconColor,
} from "@pierre/trees";
import { cn } from "@/lib/shared/utils";

const iconResolver = createFileTreeIconResolver({ set: "complete", colored: true });

let spriteInjected = false;
function ensureSpriteInjected() {
  if (spriteInjected) return;
  spriteInjected = true;
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.width = "0";
  container.style.height = "0";
  container.style.overflow = "hidden";
  container.innerHTML = getBuiltInSpriteSheet("complete");
  document.body.appendChild(container);
}

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
  ensureSpriteInjected();

  const resolved = iconResolver.resolveIcon("file-tree-icon-file" as any, path);
  const color = resolved.token ? getBuiltInFileIconColor(resolved.token) : undefined;

  return (
    <svg
      className={cn("size-4 shrink-0", className)}
      width={resolved.width ?? 16}
      height={resolved.height ?? 16}
      viewBox={resolved.viewBox}
      aria-hidden
      style={color ? { color } : undefined}
    >
      <use href={`#${resolved.name}`} />
    </svg>
  );
}
