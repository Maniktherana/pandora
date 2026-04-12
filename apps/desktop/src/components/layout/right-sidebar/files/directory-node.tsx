import React, { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { cn, joinAbsolutePath, joinRel } from "@/lib/shared/utils";
import { scmToneTextClass } from "@/components/layout/right-sidebar/scm/scm.utils";
import { ScmStatusBadge } from "@/components/layout/right-sidebar/scm/scm-status-badge";
import DotGridLoader from "@/components/dot-grid-loader";
import { FileTreeRow } from "./file-tree-row";
import {
  DIRECTORY_STICKY_ROW_OFFSET_PX,
  DIRECTORY_STICKY_Z_INDEX_BASE,
  STICKY_TOP_COMPENSATION_PX,
  TREE_ROW_HEIGHT_PX,
  TREE_ROW_INDENT_PX,
  TREE_ROW_PADDING_LEFT_PX,
  type FileTreeRowHandle,
  type PendingCreateState,
  type PendingRenameState,
  type ScmDecorationResolver,
} from "./files.types";
import { useWorkspaceDirectoryQuery } from "./files-queries";
import { TreeCreateInput } from "./tree-create-input";
import { TreeRenameInput } from "./tree-rename-input";

function scmExpandedToneTextClass(
  tone: "added" | "modified" | "deleted" | "renamed" | "conflict" | "ignored" | null,
  dimmed = false,
): string {
  if (dimmed || tone === "ignored") return "aria-expanded:text-[var(--theme-text-faint)]";
  switch (tone) {
    case "added":
      return "aria-expanded:text-[var(--theme-scm-added)]";
    case "modified":
      return "aria-expanded:text-[var(--theme-scm-modified)]";
    case "deleted":
      return "aria-expanded:text-[var(--theme-scm-deleted)]";
    case "renamed":
      return "aria-expanded:text-[var(--theme-scm-renamed)]";
    case "conflict":
      return "aria-expanded:text-[var(--theme-scm-conflict)]";
    default:
      return "aria-expanded:text-[var(--theme-text-subtle)]";
  }
}

type DirectoryNodeProps = {
  workspaceRoot: string;
  workspaceId: string;
  relPath: string;
  parentRelPath: string;
  name: string;
  depth: number;
  isIgnored?: boolean;
  resolveDecoration: ScmDecorationResolver;
  isExpanded: boolean;
  isPathExpanded: (relPath: string) => boolean;
  setPathExpanded: (relPath: string, expanded: boolean) => void;
  onOpenContextMenu?: (
    clientX: number,
    clientY: number,
    relPath: string,
    kind: "file" | "directory",
  ) => void;
  activePath: string | null;
  highlightedLeafDirectory: string | null;
  targetDirectory: string | null;
  isHoverSuppressed: boolean;
  showDirectoryIcon?: boolean;
  directoryScmBadgeVariant?: "text" | "dot";
  onRowPointerDown: (event: React.PointerEvent, handle: FileTreeRowHandle) => void;
  onRowClickCapture: (event: React.MouseEvent) => void;
  pendingCreate: PendingCreateState;
  onConfirmCreate: (name: string, kind: "file" | "directory", parentRelPath: string) => void;
  onCancelCreate: () => void;
  pendingRename: PendingRenameState;
  onConfirmRename: (sourceRelPath: string, nextName: string) => void;
  onCancelRename: () => void;
};

export const DirectoryNode = React.memo(function DirectoryNode({
  workspaceRoot,
  workspaceId,
  relPath,
  parentRelPath,
  name,
  depth,
  isIgnored,
  resolveDecoration,
  isExpanded,
  isPathExpanded,
  setPathExpanded,
  onOpenContextMenu,
  activePath,
  highlightedLeafDirectory,
  targetDirectory,
  isHoverSuppressed,
  showDirectoryIcon = true,
  directoryScmBadgeVariant = "dot",
  onRowPointerDown,
  onRowClickCapture,
  pendingCreate,
  onConfirmCreate,
  onCancelCreate,
  pendingRename,
  onConfirmRename,
  onCancelRename,
}: DirectoryNodeProps) {
  const { openFile } = useEditorActions();
  const [open, setOpen] = useState(isExpanded);
  const [isStickyActive, setIsStickyActive] = useState(false);
  const rowRef = useRef<HTMLElement | null>(null);
  const decoration = resolveDecoration(relPath, true, isIgnored);
  const isTargetedDirectory = targetDirectory !== null && targetDirectory === relPath;
  const rowPaddingLeft = TREE_ROW_PADDING_LEFT_PX + depth * TREE_ROW_INDENT_PX;

  useEffect(() => {
    setOpen(isExpanded);
  }, [isExpanded]);

  const childrenQuery = useWorkspaceDirectoryQuery({
    workspaceId,
    workspaceRoot,
    relativePath: relPath,
    enabled: open,
  });
  const children = childrenQuery.data ?? null;
  const loadError = childrenQuery.error ? String(childrenQuery.error) : null;

  useEffect(() => {
    if (!open) {
      setIsStickyActive(false);
      return;
    }

    const row = rowRef.current;
    const scroller = row?.closest<HTMLElement>("[data-file-tree-sidebar='true']");
    if (!row || !scroller) return;

    const stickyTop = depth * DIRECTORY_STICKY_ROW_OFFSET_PX - STICKY_TOP_COMPENSATION_PX;
    const updateStickyState = () => {
      const rowTop = row.getBoundingClientRect().top;
      const scrollerTop = scroller.getBoundingClientRect().top;
      const targetTop = scrollerTop + stickyTop;
      setIsStickyActive(Math.abs(rowTop - targetTop) <= 0.5);
    };

    updateStickyState();
    scroller.addEventListener("scroll", updateStickyState, { passive: true });
    window.addEventListener("resize", updateStickyState);
    return () => {
      scroller.removeEventListener("scroll", updateStickyState);
      window.removeEventListener("resize", updateStickyState);
    };
  }, [depth, open]);

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setPathExpanded(relPath, next);
      }}
    >
      <CollapsibleTrigger
        nativeButton={false}
        render={
          <Button
            render={<div />}
            variant="ghost"
            size="sm"
            className={cn(
              "group relative w-full justify-start gap-2 rounded-md py-0 pr-2 pl-0 text-left text-xs font-normal transition-none",
              {
                "sticky bg-[var(--theme-bg)] aria-expanded:bg-[var(--theme-bg)] dark:aria-expanded:bg-[var(--theme-bg)]":
                  open,
                "hover:bg-[var(--theme-panel-hover)] dark:hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)] aria-expanded:hover:bg-[var(--theme-panel-hover)] dark:aria-expanded:hover:bg-[var(--theme-panel-hover)]":
                  !isStickyActive,
              },
              scmToneTextClass(decoration.tone, decoration.dimmed),
              scmExpandedToneTextClass(decoration.tone, decoration.dimmed),
              decoration.dimmed && "opacity-55",
              isTargetedDirectory && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]",
            )}
            data-tree-row-path={relPath}
            data-tree-row-kind="directory"
            data-tree-parent-path={parentRelPath}
            ref={(node) => {
              rowRef.current = node;
            }}
            style={{
              height: TREE_ROW_HEIGHT_PX,
              minHeight: TREE_ROW_HEIGHT_PX,
              paddingLeft: rowPaddingLeft,
              ...(open
                ? {
                    top: depth * DIRECTORY_STICKY_ROW_OFFSET_PX - STICKY_TOP_COMPENSATION_PX,
                    zIndex: DIRECTORY_STICKY_Z_INDEX_BASE - depth,
                  }
                : null),
            }}
            onPointerDown={(event) =>
              onRowPointerDown(event, {
                kind: "directory",
                relPath,
                parentRelPath,
                label: name,
                absolutePath: joinAbsolutePath(workspaceRoot, relPath),
              })
            }
            onClickCapture={onRowClickCapture}
            onContextMenu={(event) => {
              if (!onOpenContextMenu) return;
              event.preventDefault();
              onOpenContextMenu(event.clientX, event.clientY, relPath, "directory");
            }}
          >
            <ChevronRight className="size-4 shrink-0 group-data-[panel-open]:rotate-90" />
            {showDirectoryIcon ? (
              <FileTypeIcon path={relPath} kind="directory" expanded={open} />
            ) : null}
            <span className="truncate">{name}</span>
            {decoration.badge ? (
              <ScmStatusBadge
                text={decoration.badge}
                tone={decoration.tone}
                variant={directoryScmBadgeVariant}
                className="ml-auto"
              />
            ) : null}
          </Button>
        }
      />
      <CollapsibleContent>
        <div className="flex flex-col">
          {pendingCreate && pendingCreate.parentRelPath === relPath && (
            <TreeCreateInput
              kind={pendingCreate.kind}
              parentRelPath={pendingCreate.parentRelPath}
              depth={depth + 1}
              onConfirm={onConfirmCreate}
              onCancel={onCancelCreate}
            />
          )}
          {loadError && (
            <div
              className="px-2 py-1 text-[11px] text-[var(--theme-error)]"
              style={{
                paddingLeft:
                  TREE_ROW_PADDING_LEFT_PX + TREE_ROW_INDENT_PX + depth * TREE_ROW_INDENT_PX,
              }}
            >
              {loadError}
            </div>
          )}
          {open && children === null && childrenQuery.isFetching && !loadError && (
            <div
              className="flex items-center justify-center py-3"
              style={{
                paddingLeft:
                  TREE_ROW_PADDING_LEFT_PX + TREE_ROW_INDENT_PX + depth * TREE_ROW_INDENT_PX,
              }}
            >
              <DotGridLoader
                variant="default"
                gridSize={3}
                sizeClassName="h-5 w-5"
                className="opacity-80"
              />
            </div>
          )}
          {children?.map((entry) =>
            (() => {
              const childRelPath = joinRel(relPath, entry.name);
              if (pendingRename?.relPath === childRelPath) {
                return (
                  <TreeRenameInput
                    key={childRelPath}
                    kind={entry.isDirectory ? "directory" : "file"}
                    depth={depth + 1}
                    initialName={pendingRename.currentName}
                    sourceRelPath={pendingRename.relPath}
                    onConfirm={onConfirmRename}
                    onCancel={onCancelRename}
                  />
                );
              }
              return entry.isDirectory ? (
                <DirectoryNode
                  key={childRelPath}
                  workspaceRoot={workspaceRoot}
                  workspaceId={workspaceId}
                  relPath={childRelPath}
                  parentRelPath={relPath}
                  name={entry.name}
                  depth={depth + 1}
                  isIgnored={entry.isIgnored}
                  resolveDecoration={resolveDecoration}
                  isExpanded={isPathExpanded(childRelPath)}
                  isPathExpanded={isPathExpanded}
                  setPathExpanded={setPathExpanded}
                  onOpenContextMenu={onOpenContextMenu}
                  activePath={activePath}
                  highlightedLeafDirectory={highlightedLeafDirectory}
                  targetDirectory={targetDirectory}
                  isHoverSuppressed={isHoverSuppressed}
                  showDirectoryIcon={showDirectoryIcon}
                  directoryScmBadgeVariant={directoryScmBadgeVariant}
                  onRowPointerDown={onRowPointerDown}
                  onRowClickCapture={onRowClickCapture}
                  pendingCreate={pendingCreate}
                  onConfirmCreate={onConfirmCreate}
                  onCancelCreate={onCancelCreate}
                  pendingRename={pendingRename}
                  onConfirmRename={onConfirmRename}
                  onCancelRename={onCancelRename}
                />
              ) : (
                <FileTreeRow
                  key={childRelPath}
                  depth={depth + 1}
                  icon={<FileTypeIcon path={childRelPath} kind="file" />}
                  label={entry.name}
                  decoration={resolveDecoration(childRelPath, false, entry.isIgnored)}
                  fileRelPath={childRelPath}
                  onOpenContextMenu={onOpenContextMenu}
                  active={activePath === childRelPath}
                  onOpen={() => void openFile(workspaceId, workspaceRoot, childRelPath)}
                  onPointerDown={onRowPointerDown}
                  onClickCapture={onRowClickCapture}
                  rowKind="file"
                  rowRelPath={childRelPath}
                  parentRelPath={relPath}
                  absolutePath={joinAbsolutePath(workspaceRoot, childRelPath)}
                  highlightedLeafDirectory={highlightedLeafDirectory}
                  isHoverSuppressed={isHoverSuppressed}
                />
              );
            })(),
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});
