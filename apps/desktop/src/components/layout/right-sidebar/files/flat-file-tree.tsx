import React, { useCallback, useRef, type RefObject } from "react";
import { clsx } from "clsx";
import { ChevronRight } from "lucide-react";
import { useFileTreeStore } from "@/services/file-tree/file-tree-store";
import { fileTreeService } from "@/services/file-tree/file-tree-service";
import { joinAbsolutePath } from "@/lib/shared/utils";
import { gitToneTextClass } from "@/services/git/git-utils";
import { ScmStatusBadge } from "@/components/layout/right-sidebar/scm/scm-status-badge";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import type { FileTreeEntry } from "@/lib/shared/types";
import type { GitDecorationIndex, TreeGitDecoration } from "@/services/git/git-types";
import type {
  FileTreeRowHandle,
  PendingCreateState,
  PendingRenameState,
} from "./files.types";
import {
  TREE_ROW_HEIGHT_PX,
  TREE_ROW_INDENT_PX,
  TREE_ROW_PADDING_LEFT_PX,
} from "./files.types";
import { TreeCreateInput } from "./tree-create-input";
import { TreeRenameInput } from "./tree-rename-input";
import DotGridLoader from "@/components/dot-grid-loader";

const EMPTY_DECORATION: TreeGitDecoration = { badge: null, tone: null, dimmed: false };
const IGNORED_DECORATION: TreeGitDecoration = { badge: null, tone: "ignored", dimmed: true };

type SharedTreeProps = {
  workspaceId: string;
  workspaceRoot: string;
  activePath: string | null;
  decorationIndexRef: RefObject<GitDecorationIndex>;
  targetDirectory: string | null;
  highlightedLeafDirectory: string | null;
  isHoverSuppressed: boolean;
  pendingCreate: PendingCreateState;
  pendingRename: PendingRenameState;
  onOpen: (path: string) => void;
  onToggleExpand: (path: string, expanded: boolean) => void;
  onPointerDown: (event: React.PointerEvent, handle: FileTreeRowHandle) => void;
  onClickCapture: (event: React.MouseEvent) => void;
  onSelect?: ((handle: FileTreeRowHandle) => void) | undefined;
  onConfirmCreate: (name: string, kind: "file" | "directory", parentRelPath: string) => void;
  onCancelCreate: () => void;
  onConfirmRename: (sourceRelPath: string, nextName: string) => void;
  onCancelRename: () => void;
};

const TreeFileRow = React.memo(function TreeFileRow({
  path,
  parentPath,
  entry,
  depth,
  shared,
}: {
  path: string;
  parentPath: string;
  entry: FileTreeEntry;
  depth: number;
  shared: SharedTreeProps;
}) {
  const isActive = path === shared.activePath;
  const idx = shared.decorationIndexRef.current;
  const decoration = entry.isIgnored
    ? IGNORED_DECORATION
    : idx.byPath[path] ?? EMPTY_DECORATION;

  const paddingLeft = TREE_ROW_PADDING_LEFT_PX + depth * TREE_ROW_INDENT_PX;
  const absolutePath = joinAbsolutePath(shared.workspaceRoot, path);

  const handle: FileTreeRowHandle = {
    kind: "file",
    relPath: path,
    parentRelPath: parentPath,
    label: entry.name,
    absolutePath,
  };

  const isHighlightedLeaf =
    shared.highlightedLeafDirectory !== null &&
    parentPath === shared.highlightedLeafDirectory;

  return (
    <button
      type="button"
      data-tree-row-path={path}
      data-tree-row-kind="file"
      data-tree-parent-path={parentPath}
      className={clsx(
        "relative flex min-w-0 w-full select-none items-center gap-2 rounded-md py-0 pr-2 text-left text-xs font-normal",
        !shared.isHoverSuppressed && "hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]",
        gitToneTextClass(decoration.tone, decoration.dimmed),
        decoration.dimmed && "opacity-55",
        isActive && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]",
        isHighlightedLeaf && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]",
      )}
      style={{ height: TREE_ROW_HEIGHT_PX, paddingLeft }}
      onClick={() => { shared.onSelect?.(handle); shared.onOpen(path); }}
      onPointerDown={(e) => shared.onPointerDown(e, handle)}
      onClickCapture={shared.onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
    >
      <FileTypeIcon path={path} kind="file" />
      <span className="truncate">{entry.name}</span>
      {decoration.badge ? (
        <ScmStatusBadge text={decoration.badge} tone={decoration.tone} className="ml-auto" />
      ) : null}
    </button>
  );
});

const TreeDirectoryRow = React.memo(function TreeDirectoryRow({
  path,
  parentPath,
  entry,
  depth,
  isExpanded,
  shared,
}: {
  path: string;
  parentPath: string;
  entry: FileTreeEntry;
  depth: number;
  isExpanded: boolean;
  shared: SharedTreeProps;
}) {
  const isActive = path === shared.activePath;
  const idx = shared.decorationIndexRef.current;
  const decoration = entry.isIgnored
    ? IGNORED_DECORATION
    : idx.byDirectory[path] ?? EMPTY_DECORATION;

  const paddingLeft = TREE_ROW_PADDING_LEFT_PX + depth * TREE_ROW_INDENT_PX;
  const absolutePath = joinAbsolutePath(shared.workspaceRoot, path);

  const handle: FileTreeRowHandle = {
    kind: "directory",
    relPath: path,
    parentRelPath: parentPath,
    label: entry.name,
    absolutePath,
  };

  const isTargeted = shared.targetDirectory === path;

  return (
    <button
      type="button"
      data-tree-row-path={path}
      data-tree-row-kind="directory"
      data-tree-parent-path={parentPath}
      className={clsx(
        "relative flex min-w-0 w-full select-none items-center gap-2 rounded-md py-0 pr-2 text-left text-xs font-normal",
        !shared.isHoverSuppressed && "hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]",
        gitToneTextClass(decoration.tone, decoration.dimmed),
        decoration.dimmed && "opacity-55",
        "transition-none",
        isActive && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]",
        isTargeted && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]",
      )}
      style={{ height: TREE_ROW_HEIGHT_PX, paddingLeft }}
      onClick={() => { shared.onSelect?.(handle); shared.onToggleExpand(path, !isExpanded); }}
      onPointerDown={(e) => shared.onPointerDown(e, handle)}
      onClickCapture={shared.onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
      aria-expanded={isExpanded}
    >
      <ChevronRight
        className={clsx("size-4 shrink-0 transition-transform duration-100", {
          "rotate-90": isExpanded,
        })}
      />
      <FileTypeIcon path={path} kind="directory" expanded={isExpanded} />
      <span className="truncate">{entry.name}</span>
      {decoration.badge ? (
        <ScmStatusBadge
          text={decoration.badge}
          tone={decoration.tone}
          variant="dot"
          className="ml-auto"
        />
      ) : null}
    </button>
  );
});

const TreeDirectoryEntry = React.memo(function TreeDirectoryEntry({
  path,
  parentPath,
  entry,
  depth,
  shared,
}: {
  path: string;
  parentPath: string;
  entry: FileTreeEntry;
  depth: number;
  shared: SharedTreeProps;
}) {
  const isExpanded = useFileTreeStore(
    (s) => s.byScopeId[shared.workspaceId]?.expandedPaths.has(path) ?? false,
  );

  const isBeingRenamed =
    shared.pendingRename !== null && shared.pendingRename.relPath === path;

  if (isBeingRenamed) {
    return (
      <TreeRenameInput
        kind="directory"
        depth={depth}
        initialName={shared.pendingRename!.currentName}
        sourceRelPath={path}
        onConfirm={shared.onConfirmRename}
        onCancel={shared.onCancelRename}
      />
    );
  }

  return (
    <>
      <TreeDirectoryRow
        path={path}
        parentPath={parentPath}
        entry={entry}
        depth={depth}
        isExpanded={isExpanded}
        shared={shared}
      />
      {isExpanded && (
        <TreeDirectory
          parentPath={path}
          depth={depth + 1}
          shared={shared}
        />
      )}
    </>
  );
});

const TreeFileEntry = React.memo(function TreeFileEntry({
  path,
  parentPath,
  entry,
  depth,
  shared,
}: {
  path: string;
  parentPath: string;
  entry: FileTreeEntry;
  depth: number;
  shared: SharedTreeProps;
}) {
  const isBeingRenamed =
    shared.pendingRename !== null && shared.pendingRename.relPath === path;

  if (isBeingRenamed) {
    return (
      <TreeRenameInput
        kind="file"
        depth={depth}
        initialName={shared.pendingRename!.currentName}
        sourceRelPath={path}
        onConfirm={shared.onConfirmRename}
        onCancel={shared.onCancelRename}
      />
    );
  }

  return (
    <TreeFileRow
      path={path}
      parentPath={parentPath}
      entry={entry}
      depth={depth}
      shared={shared}
    />
  );
});

const TreeDirectory = React.memo(function TreeDirectory({
  parentPath,
  depth,
  shared,
}: {
  parentPath: string;
  depth: number;
  shared: SharedTreeProps;
}) {
  const entries = useFileTreeStore(
    (s) => s.byScopeId[shared.workspaceId]?.directories[parentPath],
  );

  if (!entries) return null;

  const pendingCreateHere =
    shared.pendingCreate !== null && shared.pendingCreate.parentRelPath === parentPath;

  return (
    <>
      {pendingCreateHere && (
        <TreeCreateInput
          kind={shared.pendingCreate!.kind}
          parentRelPath={parentPath}
          depth={depth}
          onConfirm={shared.onConfirmCreate}
          onCancel={shared.onCancelCreate}
        />
      )}
      {entries.map((entry) => {
        const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        if (entry.isDirectory) {
          return (
            <TreeDirectoryEntry
              key={path}
              path={path}
              parentPath={parentPath}
              entry={entry}
              depth={depth}
              shared={shared}
            />
          );
        }
        return (
          <TreeFileEntry
            key={path}
            path={path}
            parentPath={parentPath}
            entry={entry}
            depth={depth}
            shared={shared}
          />
        );
      })}
    </>
  );
});

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
  onRowSelect?: (handle: FileTreeRowHandle) => void;
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
  onRowSelect,
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

  const containerRef = useRef<HTMLDivElement | null>(null);
  const setContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;
      onContainerRef?.(el);
    },
    [onContainerRef],
  );

  const decorationIndexRef: RefObject<GitDecorationIndex> = useRef(decorationIndex);
  decorationIndexRef.current = decorationIndex;

  const handleToggleExpand = useCallback(
    (path: string, expanded: boolean) => {
      fileTreeService.setExpanded(workspaceId, path, expanded);
    },
    [workspaceId],
  );

  const shared: SharedTreeProps = {
    workspaceId,
    workspaceRoot,
    activePath,
    decorationIndexRef,
    targetDirectory,
    highlightedLeafDirectory,
    isHoverSuppressed,
    pendingCreate,
    pendingRename,
    onOpen: onFileOpen,
    onToggleExpand: handleToggleExpand,
    onPointerDown: onRowPointerDown,
    onClickCapture: onRowClickCapture,
    onSelect: onRowSelect,
    onConfirmCreate,
    onCancelCreate,
    onConfirmRename,
    onCancelRename,
  };

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
      <TreeDirectory
        parentPath=""
        depth={0}
        shared={shared}
      />
    </div>
  );
}
