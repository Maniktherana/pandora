import React from "react";
import { clsx } from "clsx";
import { ChevronRight } from "lucide-react";
import { joinAbsolutePath } from "@/lib/shared/utils";
import { gitToneTextClass } from "@/services/git/git-utils";
import { ScmStatusBadge } from "@/components/layout/right-sidebar/scm/scm-status-badge";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import type { TreeGitDecoration } from "@/services/git/git-types";
import type { FileTreeVisibleRow } from "@/services/file-tree/file-tree-types";
import type { FileTreeRowHandle } from "./files.types";
import {
  TREE_ROW_HEIGHT_PX,
  TREE_ROW_INDENT_PX,
  TREE_ROW_PADDING_LEFT_PX,
} from "./files.types";

type FileTreeVisibleRowProps = {
  row: FileTreeVisibleRow;
  workspaceRoot: string;
  workspaceId: string;
  decoration: TreeGitDecoration;
  active: boolean;
  isTargetedDirectory: boolean;
  highlightedLeafDirectory: string | null;
  isHoverSuppressed: boolean;
  onOpen: (path: string) => void;
  onToggleExpand: (path: string, expanded: boolean) => void;
  onPointerDown: (event: React.PointerEvent, handle: FileTreeRowHandle) => void;
  onClickCapture: (event: React.MouseEvent) => void;
  /** Called from onClick so selection state updates in the click path, not pointerdown. */
  onSelect?: (handle: FileTreeRowHandle) => void;
};

function areRowPropsEqual(prev: FileTreeVisibleRowProps, next: FileTreeVisibleRowProps): boolean {
  if (prev.row !== next.row) return false;
  if (prev.active !== next.active) return false;
  if (prev.isTargetedDirectory !== next.isTargetedDirectory) return false;
  if (prev.highlightedLeafDirectory !== next.highlightedLeafDirectory) return false;
  if (prev.isHoverSuppressed !== next.isHoverSuppressed) return false;
  if (prev.onOpen !== next.onOpen) return false;
  if (prev.onToggleExpand !== next.onToggleExpand) return false;
  if (prev.onPointerDown !== next.onPointerDown) return false;
  if (prev.onClickCapture !== next.onClickCapture) return false;
  if (prev.onSelect !== next.onSelect) return false;
  if (prev.decoration.badge !== next.decoration.badge) return false;
  if (prev.decoration.tone !== next.decoration.tone) return false;
  if (prev.decoration.dimmed !== next.decoration.dimmed) return false;
  return true;
}

export const FileTreeVisibleRowView = React.memo(function FileTreeVisibleRowView({
  row,
  workspaceRoot,
  decoration,
  active,
  isTargetedDirectory,
  highlightedLeafDirectory,
  isHoverSuppressed,
  onOpen,
  onToggleExpand,
  onPointerDown,
  onClickCapture,
  onSelect,
}: FileTreeVisibleRowProps) {
  const paddingLeft = TREE_ROW_PADDING_LEFT_PX + row.depth * TREE_ROW_INDENT_PX;
  const absolutePath = joinAbsolutePath(workspaceRoot, row.path);

  const handle: FileTreeRowHandle = {
    kind: row.kind,
    relPath: row.path,
    parentRelPath: row.parentPath,
    label: row.name,
    absolutePath,
  };

  const isHighlightedLeaf =
    row.kind === "file" &&
    highlightedLeafDirectory !== null &&
    row.parentPath === highlightedLeafDirectory;

  const baseRowClass = clsx(
    "relative flex min-w-0 w-full select-none items-center gap-2 rounded-md py-0 pr-2 text-left text-xs font-normal",
    !isHoverSuppressed && "hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]",
    gitToneTextClass(decoration.tone, decoration.dimmed),
    decoration.dimmed && "opacity-55",
  );

  if (row.kind === "directory") {
    return (
      <button
        type="button"
        data-tree-row-path={row.path}
        data-tree-row-kind="directory"
        data-tree-parent-path={row.parentPath}
        className={clsx(
          baseRowClass,
          "transition-none",
          active && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]",
          isTargetedDirectory && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]",
        )}
        style={{ height: TREE_ROW_HEIGHT_PX, paddingLeft }}
        onClick={() => { onSelect?.(handle); onToggleExpand(row.path, !row.isExpanded); }}
        onPointerDown={(e) => onPointerDown(e, handle)}
        onClickCapture={onClickCapture}
        onContextMenu={(e) => e.preventDefault()}
        aria-expanded={row.isExpanded}
      >
        <ChevronRight
          className={clsx("size-4 shrink-0 transition-transform duration-100", {
            "rotate-90": row.isExpanded,
          })}
        />
        <FileTypeIcon path={row.path} kind="directory" expanded={row.isExpanded} />
        <span className="truncate">{row.name}</span>
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
  }

  return (
    <button
      type="button"
      data-tree-row-path={row.path}
      data-tree-row-kind="file"
      data-tree-parent-path={row.parentPath}
      className={clsx(
        baseRowClass,
        active && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]",
        isHighlightedLeaf && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]",
      )}
      style={{ height: TREE_ROW_HEIGHT_PX, paddingLeft }}
      onClick={() => { onSelect?.(handle); onOpen(row.path); }}
      onPointerDown={(e) => onPointerDown(e, handle)}
      onClickCapture={onClickCapture}
      onContextMenu={(e) => e.preventDefault()}
    >
      <FileTypeIcon path={row.path} kind="file" />
      <span className="truncate">{row.name}</span>
      {decoration.badge ? (
        <ScmStatusBadge text={decoration.badge} tone={decoration.tone} className="ml-auto" />
      ) : null}
    </button>
  );
}, areRowPropsEqual);
