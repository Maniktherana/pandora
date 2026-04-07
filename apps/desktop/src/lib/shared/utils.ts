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
 *
 * Important: expand the actual grab area via `hitAreaMargins` on `PanelResizeHandle`
 * so we don't introduce visible gaps/bars between panels.
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
          // Keep layout footprint visible at 2px; hit area is expanded via hitAreaMargins.
          "h-full w-[2px] cursor-col-resize",
          "bg-[var(--theme-text-faint)] transition-colors",
          "data-[resize-handle-state=hover]:bg-[var(--theme-interactive)]",
          "data-[resize-handle-state=drag]:bg-[var(--theme-interactive)]",
        ]
      : [
          "h-[2px] w-full cursor-row-resize",
          "bg-[var(--theme-text-faint)] transition-colors",
          "data-[resize-handle-state=hover]:bg-[var(--theme-interactive)]",
          "data-[resize-handle-state=drag]:bg-[var(--theme-interactive)]",
        ],
  );
}
