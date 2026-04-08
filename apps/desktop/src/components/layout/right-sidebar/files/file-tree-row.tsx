import React from "react";
import { cn } from "@/lib/shared/utils";
import { scmToneTextClass } from "@/components/layout/right-sidebar/scm/scm.utils";
import { ScmStatusBadge } from "@/components/layout/right-sidebar/scm/scm-status-badge";
import type { TreeScmDecoration } from "@/components/layout/right-sidebar/scm/scm.types";
import { TREE_ROW_HEIGHT_PX, TREE_ROW_INDENT_PX, TREE_ROW_PADDING_LEFT_PX, type FileTreeRowHandle, type TreeRowKind } from "./files.types";

type FileTreeRowProps = {
  depth: number;
  icon: React.ReactNode;
  label: string;
  decoration: TreeScmDecoration;
  className?: string;
  onOpen?: () => void;
  onPointerDown?: (event: React.PointerEvent, handle: FileTreeRowHandle) => void;
  onClickCapture?: (event: React.MouseEvent) => void;
  fileRelPath?: string;
  onOpenContextMenu?: (clientX: number, clientY: number, relPath: string, kind: TreeRowKind) => void;
  active?: boolean;
  rowKind: TreeRowKind;
  rowRelPath: string;
  parentRelPath: string;
  absolutePath: string;
  highlightedLeafDirectory: string | null;
  isHoverSuppressed: boolean;
};

export function FileTreeRow({
  depth,
  icon,
  label,
  decoration,
  className,
  onOpen,
  onPointerDown,
  onClickCapture,
  fileRelPath,
  onOpenContextMenu,
  active,
  rowKind,
  rowRelPath,
  parentRelPath,
  absolutePath,
  highlightedLeafDirectory,
  isHoverSuppressed,
}: FileTreeRowProps) {
  const isHighlightedLeaf =
    rowKind === "file" &&
    highlightedLeafDirectory !== null &&
    parentRelPath === highlightedLeafDirectory;

  const handle: FileTreeRowHandle = {
    kind: rowKind,
    relPath: rowRelPath,
    parentRelPath,
    label,
    absolutePath,
  };

  const content = (
    <>
      {icon}
      <span className="truncate">{label}</span>
      {decoration.badge ? (
        <ScmStatusBadge text={decoration.badge} tone={decoration.tone} className="ml-auto" />
      ) : null}
    </>
  );

  const rowClassName = cn(
    "relative flex min-w-0 w-full select-none items-center gap-2 rounded-md py-1 pr-2 text-left text-xs",
    !isHoverSuppressed && "hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]",
    scmToneTextClass(decoration.tone, decoration.dimmed),
    decoration.dimmed && "opacity-55",
    active && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]",
    isHighlightedLeaf && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]",
    className,
  );

  if (onOpen) {
    return (
      <button
        type="button"
        data-tree-row-path={rowRelPath}
        data-tree-row-kind={rowKind}
        data-tree-parent-path={parentRelPath}
        className={rowClassName}
        style={{ paddingLeft: TREE_ROW_PADDING_LEFT_PX + depth * TREE_ROW_INDENT_PX, height: TREE_ROW_HEIGHT_PX }}
        onPointerDown={(event) => onPointerDown?.(event, handle)}
        onClickCapture={onClickCapture}
        onClick={onOpen}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!fileRelPath || !onOpenContextMenu) return;
          onOpenContextMenu(event.clientX, event.clientY, fileRelPath, rowKind);
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      data-tree-row-path={rowRelPath}
      data-tree-row-kind={rowKind}
      data-tree-parent-path={parentRelPath}
      className={rowClassName}
      style={{ paddingLeft: TREE_ROW_PADDING_LEFT_PX + depth * TREE_ROW_INDENT_PX, height: TREE_ROW_HEIGHT_PX }}
      onPointerDown={(event) => onPointerDown?.(event, handle)}
      onClickCapture={onClickCapture}
    >
      {content}
    </div>
  );
}
