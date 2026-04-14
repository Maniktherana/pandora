import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function getParentRelPath(relPath: string): string {
  const index = relPath.lastIndexOf("/");
  return index === -1 ? "" : relPath.slice(0, index);
}

export function joinAbsolutePath(workspaceRoot: string, relPath: string): string {
  return relPath ? `${workspaceRoot}/${relPath}` : workspaceRoot;
}

/**
 * Resize handle styling that keeps the layout footprint at 1px.
 */
export function panelResizeHandleClasses(
  direction: "horizontal" | "vertical",
  enabledOrOptions: boolean | { enabled?: boolean } = true,
): string {
  const enabled =
    typeof enabledOrOptions === "boolean" ? enabledOrOptions : (enabledOrOptions.enabled ?? true);
  return cn(
    // High z-index so terminal/editor surfaces can't steal the hit area.
    "relative z-50 shrink-0 border-0 bg-transparent p-0 outline-none pointer-events-auto touch-none",
    enabled ? "" : "hidden",
    direction === "horizontal"
      ? [
          // Wider hit target with a 1px visible divider centered inside it.
          "h-full w-3 -mx-[5.5px] cursor-col-resize",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2",
          "before:bg-[var(--theme-border)] before:transition-colors",
          "data-[resize-handle-state=hover]:before:bg-[var(--theme-text-subtle)]",
          "data-[resize-handle-state=drag]:before:bg-[var(--theme-border)]",
        ]
      : [
          "h-3 w-full -my-[5.5px] cursor-row-resize",
          "before:absolute before:inset-x-0 before:top-1/2 before:h-px before:-translate-y-1/2",
          "before:bg-[var(--theme-border)] before:transition-colors",
          "data-[resize-handle-state=hover]:before:bg-[var(--theme-text-subtle)]",
          "data-[resize-handle-state=drag]:before:bg-[var(--theme-border)]",
        ],
  );
}

export function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs < 1_000) {
    return `${value}`;
  }
  if (abs < 1_000_000) {
    return `${(value / 1_000).toFixed(2)}k`;
  }
  if (abs < 1_000_000_000) {
    return `${(value / 1_000_000).toFixed(2)}m`;
  }
  return `${(value / 1_000_000_000).toFixed(2)}b`;
}
