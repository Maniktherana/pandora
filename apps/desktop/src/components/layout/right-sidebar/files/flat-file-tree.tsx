import React, { useCallback, useMemo, useRef } from "react";
import { useFileTreeStore } from "@/services/file-tree/file-tree-store";
import { fileTreeService } from "@/services/file-tree/file-tree-service";
import type { FileTreeVisibleRow } from "@/services/file-tree/file-tree-types";
import type { GitDecorationIndex, TreeGitDecoration } from "@/services/git/git-types";
import type {
  FileTreeRowHandle,
  PendingCreateState,
  PendingRenameState,
} from "./files.types";
import { FileTreeVisibleRowView } from "./file-tree-visible-row";
import { TreeCreateInput } from "./tree-create-input";
import { TreeRenameInput } from "./tree-rename-input";
import DotGridLoader from "@/components/dot-grid-loader";

const EMPTY_ROWS: FileTreeVisibleRow[] = [];
const EMPTY_DECORATION: TreeGitDecoration = { badge: null, tone: null, dimmed: false };
const IGNORED_DECORATION: TreeGitDecoration = { badge: null, tone: "ignored", dimmed: true };

// ---------------------------------------------------------------------------
// Display item list — merges pending create/rename into the visible row list.
// ---------------------------------------------------------------------------

type DisplayItem =
  | { type: "row"; row: FileTreeVisibleRow }
  | { type: "create-input"; parentRelPath: string; kind: "file" | "directory"; depth: number }
  | { type: "rename-input"; row: FileTreeVisibleRow; initialName: string };

function buildDisplayItems(
  rows: FileTreeVisibleRow[],
  pendingCreate: PendingCreateState,
  pendingRename: PendingRenameState,
): DisplayItem[] {
  if (!pendingCreate && !pendingRename) {
    return rows.map((row) => ({ type: "row", row }));
  }

  const items: DisplayItem[] = [];

  if (pendingCreate && pendingCreate.parentRelPath === "") {
    items.push({
      type: "create-input",
      parentRelPath: "",
      kind: pendingCreate.kind,
      depth: 0,
    });
  }

  for (const row of rows) {
    if (pendingRename && pendingRename.relPath === row.path) {
      items.push({ type: "rename-input", row, initialName: pendingRename.currentName });
    } else {
      items.push({ type: "row", row });
    }

    if (
      pendingCreate &&
      pendingCreate.parentRelPath !== "" &&
      pendingCreate.parentRelPath === row.path &&
      row.kind === "directory" &&
      row.isExpanded
    ) {
      items.push({
        type: "create-input",
        parentRelPath: pendingCreate.parentRelPath,
        kind: pendingCreate.kind,
        depth: row.depth + 1,
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// FlatFileTree — no virtualization, no ResizeObserver, no scroll state.
// Reads visibleRows from the store and renders them with a plain .map().
// ---------------------------------------------------------------------------

export type FlatFileTreeProps = {
  workspaceId: string;
  workspaceRoot: string;
  activePath: string | null;
  decorationIndex: GitDecorationIndex;
  targetDirectory: string | null;
  highlightedLeafDirectory: string | null;
  isHoverSuppressed: boolean;
  pendingCreate: PendingCreateState;
  pendingRename: PendingRenameState;
  onContainerRef?: (el: HTMLDivElement | null) => void;
  onFileOpen: (path: string) => void;
  onRowPointerDown: (event: React.PointerEvent, handle: FileTreeRowHandle) => void;
  onRowClickCapture: (event: React.MouseEvent) => void;
  onConfirmCreate: (name: string, kind: "file" | "directory", parentRelPath: string) => void;
  onCancelCreate: () => void;
  onConfirmRename: (sourceRelPath: string, nextName: string) => void;
  onCancelRename: () => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onDragEnter: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
};

export function FlatFileTree({
  workspaceId,
  workspaceRoot,
  activePath,
  decorationIndex,
  targetDirectory,
  highlightedLeafDirectory,
  isHoverSuppressed,
  pendingCreate,
  pendingRename,
  onContainerRef,
  onFileOpen,
  onRowPointerDown,
  onRowClickCapture,
  onConfirmCreate,
  onCancelCreate,
  onConfirmRename,
  onCancelRename,
  onKeyDown,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: FlatFileTreeProps) {
  const bootStatus = useFileTreeStore((s) => s.byScopeId[workspaceId]?.bootStatus ?? "idle");
  const rootError = useFileTreeStore((s) => s.byScopeId[workspaceId]?.lastError ?? null);
  const visibleRows = useFileTreeStore(
    (s) => s.byScopeId[workspaceId]?.visibleRows ?? EMPTY_ROWS,
  );

  // Stable ref for drag hook — no scroll/resize measurement needed.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      onContainerRef?.(el);
    },
    [onContainerRef],
  );

  // O(1) decoration lookup — decorationIndex is pre-built in GitStore.applySnapshot.
  const resolveDecoration = useCallback(
    (row: FileTreeVisibleRow): TreeGitDecoration => {
      if (row.isIgnored) return IGNORED_DECORATION;
      return (
        (row.kind === "directory"
          ? decorationIndex.byDirectory[row.path]
          : decorationIndex.byPath[row.path]) ?? EMPTY_DECORATION
      );
    },
    [decorationIndex],
  );

  // Directory click → synchronous store update → no IPC, no async, no transitions.
  const handleToggleExpand = useCallback(
    (path: string, expanded: boolean) => {
      fileTreeService.setExpanded(workspaceId, path, expanded);
    },
    [workspaceId],
  );

  // Display items merge pending create/rename into the visible row list.
  const displayItems = useMemo(
    () => buildDisplayItems(visibleRows, pendingCreate, pendingRename),
    [visibleRows, pendingCreate, pendingRename],
  );

  // Show loader only during initial boot — never again once loaded.
  if (bootStatus === "idle" || bootStatus === "loading") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4">
        <DotGridLoader variant="default" gridSize={5} sizeClassName="h-8 w-8" className="opacity-90" />
      </div>
    );
  }

  return (
    <div
      ref={setContainerRef}
      data-file-tree-sidebar="true"
      tabIndex={-1}
      className="min-h-0 h-full overflow-auto overscroll-none px-1.5 pb-2 outline-none"
      style={{ overscrollBehavior: "none" }}
      onKeyDown={onKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {rootError && (
        <div className="px-2 py-2 text-xs text-[var(--theme-error)]">{rootError}</div>
      )}

      {displayItems.map((item) => {
        if (item.type === "create-input") {
          return (
            <TreeCreateInput
              key={`create:${item.parentRelPath}`}
              kind={item.kind}
              parentRelPath={item.parentRelPath}
              depth={item.depth}
              onConfirm={onConfirmCreate}
              onCancel={onCancelCreate}
            />
          );
        }

        if (item.type === "rename-input") {
          return (
            <TreeRenameInput
              key={`rename:${item.row.path}`}
              kind={item.row.kind}
              depth={item.row.depth}
              initialName={item.initialName}
              sourceRelPath={item.row.path}
              onConfirm={onConfirmRename}
              onCancel={onCancelRename}
            />
          );
        }

        const { row } = item;
        return (
          <FileTreeVisibleRowView
            key={row.id}
            row={row}
            workspaceRoot={workspaceRoot}
            workspaceId={workspaceId}
            decoration={resolveDecoration(row)}
            active={row.path === activePath}
            isTargetedDirectory={targetDirectory === row.path}
            highlightedLeafDirectory={highlightedLeafDirectory}
            isHoverSuppressed={isHoverSuppressed}
            onOpen={onFileOpen}
            onToggleExpand={handleToggleExpand}
            onPointerDown={onRowPointerDown}
            onClickCapture={onRowClickCapture}
          />
        );
      })}
    </div>
  );
}
