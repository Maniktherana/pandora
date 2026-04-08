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
          // Keep the interactive area aligned with the visible divider.
          "h-full w-px cursor-col-resize",
          "bg-[var(--theme-border)] transition-colors",
          "data-[resize-handle-state=hover]:bg-[var(--theme-interactive)]",
          "data-[resize-handle-state=drag]:bg-[var(--theme-border)]",
        ]
      : [
          "h-px w-full cursor-row-resize",
          "bg-[var(--theme-border)] transition-colors",
          "data-[resize-handle-state=hover]:bg-[var(--theme-interactive)]",
          "data-[resize-handle-state=drag]:bg-[var(--theme-border)]",
        ],
  );
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
