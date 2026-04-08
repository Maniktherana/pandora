import React, { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { cn, joinAbsolutePath, joinRel } from "@/lib/shared/utils";
import { scmToneTextClass } from "@/components/layout/right-sidebar/scm/scm.utils";
import { ScmStatusBadge } from "@/components/layout/right-sidebar/scm/scm-status-badge";
import { useFileTreeExpansion } from "./file-tree-expansion-context";
import { FileTreeRow } from "./file-tree-row";
import {
  DIRECTORY_STICKY_ROW_OFFSET_PX,
  DIRECTORY_STICKY_Z_INDEX_BASE,
  STICKY_TOP_COMPENSATION_PX,
  type DirEntry,
  type FileTreeRowHandle,
  type ScmDecorationResolver,
} from "./files.types";

type DirectoryNodeProps = {
  workspaceRoot: string;
  workspaceId: string;
  relPath: string;
  parentRelPath: string;
  name: string;
  depth: number;
  isIgnored?: boolean;
  resolveDecoration: ScmDecorationResolver;
  onOpenContextMenu?: (clientX: number, clientY: number, relPath: string, kind: "file" | "directory") => void;
  activePath: string | null;
  refreshTick: number;
  highlightedLeafDirectory: string | null;
  targetDirectory: string | null;
  isHoverSuppressed: boolean;
  onRowPointerDown: (event: React.PointerEvent, handle: FileTreeRowHandle) => void;
  onRowClickCapture: (event: React.MouseEvent) => void;
};

export function DirectoryNode({
  workspaceRoot,
  workspaceId,
  relPath,
  parentRelPath,
  name,
  depth,
  isIgnored,
  resolveDecoration,
  onOpenContextMenu,
  activePath,
  refreshTick,
  highlightedLeafDirectory,
  targetDirectory,
  isHoverSuppressed,
  onRowPointerDown,
  onRowClickCapture,
}: DirectoryNodeProps) {
  const { openFile } = useEditorActions();
  const { isPathExpanded, setPathExpanded } = useFileTreeExpansion();
  const open = isPathExpanded(relPath);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const decoration = resolveDecoration(relPath, true, isIgnored);
  const isTargetedDirectory = targetDirectory !== null && targetDirectory === relPath;
  const rowPaddingLeft = 6 + depth * 12;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void invoke<DirEntry[]>("list_workspace_directory", {
      workspaceRoot,
      relativePath: relPath,
    })
      .then((list) => {
        if (!cancelled) {
          setChildren(list);
          setLoadError(null);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(String(error));
          setChildren([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, workspaceRoot, relPath, refreshTick]);

  return (
    <div>
      <Collapsible open={open} onOpenChange={(next) => setPathExpanded(relPath, next)}>
        <CollapsibleTrigger
          nativeButton={false}
          render={
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "group relative h-auto min-h-0 w-full justify-start gap-1.5 rounded-sm py-1 pr-1 pl-0 text-left font-normal transition-none",
                open &&
                  "sticky rounded-none bg-[#151515] aria-expanded:bg-[#151515] dark:aria-expanded:bg-[#151515]",
                !isHoverSuppressed &&
                  "hover:bg-[var(--theme-panel-hover)] dark:hover:bg-[var(--theme-panel-hover)] hover:text-[var(--theme-text)] aria-expanded:hover:bg-[var(--theme-panel-hover)] dark:aria-expanded:hover:bg-[var(--theme-panel-hover)]",
                scmToneTextClass(decoration.tone, decoration.dimmed),
                decoration.dimmed && "opacity-55",
                isTargetedDirectory && "bg-[var(--theme-panel-hover)] text-[var(--theme-text)]",
              )}
              data-tree-row-path={relPath}
              data-tree-row-kind="directory"
              data-tree-parent-path={parentRelPath}
              style={{
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
              <ChevronRight className="size-3.5 shrink-0 group-data-[panel-open]:rotate-90" />
              <FileTypeIcon path={relPath} kind="directory" expanded={open} />
              <span className="truncate text-xs">{name}</span>
              {decoration.badge ? (
                <ScmStatusBadge text={decoration.badge} tone={decoration.tone} className="ml-auto" />
              ) : null}
            </Button>
          }
        />
        <CollapsibleContent noTransition>
          <div className="flex flex-col">
            {loadError && (
              <div
                className="px-2 py-1 text-[11px] text-[var(--theme-error)]"
                style={{ paddingLeft: 18 + depth * 12 }}
              >
                {loadError}
              </div>
            )}
            {children?.map((entry) =>
              entry.isDirectory ? (
                <DirectoryNode
                  key={joinRel(relPath, entry.name)}
                  workspaceRoot={workspaceRoot}
                  workspaceId={workspaceId}
                  relPath={joinRel(relPath, entry.name)}
                  parentRelPath={relPath}
                  name={entry.name}
                  depth={depth + 1}
                  isIgnored={entry.isIgnored}
                  resolveDecoration={resolveDecoration}
                  onOpenContextMenu={onOpenContextMenu}
                  activePath={activePath}
                  refreshTick={refreshTick}
                  highlightedLeafDirectory={highlightedLeafDirectory}
                  targetDirectory={targetDirectory}
                  isHoverSuppressed={isHoverSuppressed}
                  onRowPointerDown={onRowPointerDown}
                  onRowClickCapture={onRowClickCapture}
                />
              ) : (
                <FileTreeRow
                  key={joinRel(relPath, entry.name)}
                  depth={depth + 1}
                  icon={<FileTypeIcon path={joinRel(relPath, entry.name)} kind="file" />}
                  label={entry.name}
                  decoration={resolveDecoration(
                    joinRel(relPath, entry.name),
                    false,
                    entry.isIgnored,
                  )}
                  fileRelPath={joinRel(relPath, entry.name)}
                  onOpenContextMenu={onOpenContextMenu}
                  active={activePath === joinRel(relPath, entry.name)}
                  onOpen={() =>
                    void openFile(workspaceId, workspaceRoot, joinRel(relPath, entry.name))
                  }
                  onPointerDown={onRowPointerDown}
                  onClickCapture={onRowClickCapture}
                  rowKind="file"
                  rowRelPath={joinRel(relPath, entry.name)}
                  parentRelPath={relPath}
                  absolutePath={joinAbsolutePath(workspaceRoot, joinRel(relPath, entry.name))}
                  highlightedLeafDirectory={highlightedLeafDirectory}
                  isHoverSuppressed={isHoverSuppressed}
                />
              ),
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
