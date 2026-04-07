import React from "react";
import { cn } from "@/lib/shared/utils";
import { scmToneTextClass, type TreeScmDecoration } from "@/lib/workspace/scm";
import type { FileTreeRowHandle, TreeRowKind } from "./file-tree.types";

export type FileTreeRowProps = {
  depth: number;
  icon: React.ReactNode;
  label: string;
  decoration: TreeScmDecoration;
  className?: string;
  onOpen?: () => void;
  onPointerDown?: (event: React.PointerEvent, handle: FileTreeRowHandle) => void;
  onClickCapture?: (event: React.MouseEvent) => void;
  fileRelPath?: string;
  onOpenDiffMenu?: (clientX: number, clientY: number, relPath: string) => void;
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
  onOpenDiffMenu,
  active,
  rowKind,
  rowRelPath,
  parentRelPath,
  absolutePath,
  highlightedLeafDirectory,
  isHoverSuppressed,
}: FileTreeRowProps) {
  const isHighlightedLeaf =
    rowKind === "file" && highlightedLeafDirectory !== null && parentRelPath === highlightedLeafDirectory;

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
        <span
          className={cn(
            "ml-auto shrink-0 font-mono text-[10px] font-semibold",
            scmToneTextClass(decoration.tone, false)
          )}
        >
          {decoration.badge}
        </span>
      ) : null}
    </>
  );

  const rowClassName = cn(
    "relative flex min-w-0 w-full select-none items-center gap-1.5 rounded-sm py-1 pr-1 text-left text-xs",
    !isHoverSuppressed && "hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)]",
    scmToneTextClass(decoration.tone, decoration.dimmed),
    decoration.dimmed && "opacity-55",
    active && "bg-[var(--theme-panel-elevated)] text-[var(--theme-text)]",
    isHighlightedLeaf && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]",
    className
  );

  if (onOpen) {
    return (
      <button
        type="button"
        data-tree-row-path={rowRelPath}
        data-tree-row-kind={rowKind}
        data-tree-parent-path={parentRelPath}
        className={rowClassName}
        style={{ paddingLeft: 6 + depth * 12 }}
        onPointerDown={(event) => onPointerDown?.(event, handle)}
        onClickCapture={onClickCapture}
        onClick={onOpen}
        onContextMenu={(event) => {
          if (!fileRelPath || !onOpenDiffMenu) return;
          event.preventDefault();
          onOpenDiffMenu(event.clientX, event.clientY, fileRelPath);
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
      style={{ paddingLeft: 6 + depth * 12 }}
      onPointerDown={(event) => onPointerDown?.(event, handle)}
      onClickCapture={onClickCapture}
    >
      {content}
    </div>
  );
}

