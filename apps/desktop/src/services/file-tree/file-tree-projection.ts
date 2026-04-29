import type { FileTreeEntry } from "@/lib/shared/types";
import type { FileTreeVisibleRow } from "./file-tree-types";

const EMPTY_ROWS: FileTreeVisibleRow[] = [];

/**
 * Build a flat ordered list of visible rows from canonical tree state.
 *
 * Framework-free pure function — no React, no JSX.  Called inside Zustand
 * store mutations so visibleRows are always in sync with tree/expansion state.
 * React consumes the result; it never triggers recomputation.
 *
 * Decoration, active state, and icon selection are render concerns and are
 * NOT included here — they are O(1) lookups at render time.
 */
export function buildVisibleRows(
  directories: Record<string, FileTreeEntry[]>,
  expandedPaths: ReadonlySet<string>,
): FileTreeVisibleRow[] {
  const rootEntries = directories[""];
  if (!rootEntries) return EMPTY_ROWS;

  const rows: FileTreeVisibleRow[] = [];

  function walk(parentPath: string, depth: number): void {
    const entries = directories[parentPath];
    if (!entries) return;
    for (const entry of entries) {
      const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
      const isDirectory = entry.isDirectory;
      const isExpanded = isDirectory && expandedPaths.has(path);

      rows.push({
        id: path,
        path,
        parentPath,
        name: entry.name,
        kind: isDirectory ? "directory" : "file",
        depth,
        isExpanded,
        isIgnored: entry.isIgnored ?? false,
      });

      if (isExpanded) {
        walk(path, depth + 1);
      }
    }
  }

  walk("", 0);
  return rows;
}
