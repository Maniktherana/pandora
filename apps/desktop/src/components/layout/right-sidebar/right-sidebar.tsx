import {
  memo,
  useCallback,
  useEffect,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabDrag } from "@/components/dnd/tab-drag-provider";
import WorkspaceChangesPanel from "@/components/layout/right-sidebar/scm/workspace-changes-panel";
import { useLayoutStore } from "@/services/workspace/layout-store";
import { findLeaf } from "@/components/layout/workspace/layout-tree";
import { useCachedGitDecorations } from "@/services/git/git-queries";
import { useFileTreeController } from "@/services/file-tree/use-file-tree";
import type {
  FileTreeRowHandle,
  LeftPanelMode,
  PendingCreateState,
  PendingRenameState,
  TreeRowKind,
} from "./files/files.types";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { FileTreeToolbar } from "./files/file-tree-toolbar";
import { TreeDragOverlay } from "./files/tree-drag-overlay";
import { FlatFileTree } from "./files/flat-file-tree";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useAvailableEditors } from "@/hooks/use-available-editors";
import { useFileTreeDrag } from "./use-file-tree-drag";
import { useFileTreeClipboard } from "./use-file-tree-clipboard";
export default memo(function RightSidebar({
  workspaceRoot,
  workspaceId,
  workspaceName,
  projectDisplayName,
  mode,
}: {
  workspaceRoot: string;
  workspaceId: string;
  workspaceName: string;
  projectDisplayName: string;
  mode: LeftPanelMode;
}) {
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [selectedTreeKind, setSelectedTreeKind] = useState<TreeRowKind | null>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreateState>(null);
  const [pendingRename, setPendingRename] = useState<PendingRenameState>(null);

  useEffect(() => {
    setSelectedTreePath(null);
    setSelectedTreeKind(null);
    setPendingCreate(null);
    setPendingRename(null);
  }, [workspaceId]);

  const { openFile } = useEditorActions();
  const { startDrag } = useTabDrag();

  const activePath = useLayoutStore((s) => {
    const layout = s.byWorkspaceId[workspaceId];
    if (!layout?.root || !layout.focusedPaneID) return null;
    const leaf = findLeaf(layout.root, layout.focusedPaneID);
    const tab = leaf?.tabs[leaf.selectedIndex] ?? leaf?.tabs[0];
    return tab && (tab.kind === "editor" || tab.kind === "diff") ? tab.path : null;
  });

  const fileTree = useFileTreeController(workspaceId);

  const decorationIndex = useCachedGitDecorations(workspaceId);

  const setPathExpanded = useCallback(
    (relPath: string, expanded: boolean) => fileTree.setPathExpanded(relPath, expanded),
    [fileTree],
  );

  const refreshTree = useCallback(() => fileTree.refresh(), [fileTree]);

  const handleCollapseAll = useCallback(() => {
    fileTree.setAllExpandedPaths(new Set());
  }, [fileTree]);

  const {
    treeBodyRef,
    dragSession,
    isHoverSuppressed,
    targetDirectory,
    highlightedLeafDirectory,
    onRowPointerDown,
    onRowClickCapture,
    handleTreeDragEnter,
    handleTreeDragOver,
    handleTreeDragLeave,
    handleTreeDrop,
  } = useFileTreeDrag({
    workspaceId,
    workspaceRoot,
    mode,
    onMove: fileTree.move,
    onImportFiles: fileTree.importFiles,
    startDrag,
  });

  // Selection updates happen in the click path (FileTreeVisibleRowView.onClick),
  // not on pointerdown, so drag prep never causes React state churn.
  const handleRowSelect = useCallback((handle: FileTreeRowHandle) => {
    setSelectedTreePath(handle.relPath);
    setSelectedTreeKind(handle.kind);
  }, []);

  // Forward the flat tree's scroll container ref into the drag hook.
  const handleContainerRef = useCallback(
    (el: HTMLDivElement | null) => {
      (treeBodyRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [treeBodyRef],
  );

  const {
    contextMenu,
    handleContextMenuOpenChange,
    handleTreeContextMenuCapture,
    handleTreeKeyDown,
    handleRenameEntry,
    handleContextMenuCopyRelativePath,
    handleContextMenuCopyPath,
    handleContextMenuCopy,
    handleContextMenuPaste,
    handleContextMenuDelete,
  } = useFileTreeClipboard({
    workspaceRoot,
    fileTree,
    setPathExpanded,
    selectedTreePath,
    activePath,
    setPendingRename,
  });

  const { data: availableEditors } = useAvailableEditors();

  const workspaceTreeLabel = `${projectDisplayName} / ${workspaceName}`;

  const resolveCreateParent = useCallback(() => {
    const path = selectedTreePath ?? activePath;
    if (!path) return "";
    if (selectedTreeKind === "directory") return path;
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
  }, [activePath, selectedTreeKind, selectedTreePath]);

  const handleCreateFile = useCallback(() => {
    const parent = resolveCreateParent();
    if (parent) setPathExpanded(parent, true);
    setPendingCreate({ kind: "file", parentRelPath: parent });
  }, [resolveCreateParent, setPathExpanded]);

  const handleCreateFolder = useCallback(() => {
    const parent = resolveCreateParent();
    if (parent) setPathExpanded(parent, true);
    setPendingCreate({ kind: "directory", parentRelPath: parent });
  }, [resolveCreateParent, setPathExpanded]);

  const handleConfirmCreate = useCallback(
    (name: string, kind: "file" | "directory", parentRelPath: string) => {
      const trimmed = name.trim();
      if (!trimmed) {
        setPendingCreate(null);
        return;
      }
      if (kind === "file") {
        fileTree.createFile(parentRelPath, trimmed, "");
        void openFile(workspaceId, workspaceRoot, parentRelPath ? `${parentRelPath}/${trimmed}` : trimmed);
      } else {
        fileTree.createDirectory(parentRelPath ? `${parentRelPath}/${trimmed}` : trimmed);
      }
      setPendingCreate(null);
    },
    [fileTree, openFile, workspaceId, workspaceRoot],
  );

  const handleCancelCreate = useCallback(() => setPendingCreate(null), []);

  const handleConfirmRename = useCallback(
    (sourceRelPath: string, nextNameRaw: string) => {
      const nextName = nextNameRaw.trim();
      const currentName = sourceRelPath.split("/").pop() ?? sourceRelPath;
      if (!nextName || nextName === currentName) {
        setPendingRename(null);
        return;
      }
      if (nextName.includes("/") || nextName.includes("\\")) {
        console.error("Rename failed: name cannot contain path separators.");
        setPendingRename(null);
        return;
      }
      fileTree.rename(sourceRelPath, nextName);
      setPendingRename(null);
    },
    [fileTree],
  );

  const handleCancelRename = useCallback(() => setPendingRename(null), []);

  const handleFileOpen = useCallback(
    (path: string) => {
      void openFile(workspaceId, workspaceRoot, path);
    },
    [openFile, workspaceId, workspaceRoot],
  );

  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden bg-[var(--theme-bg)] select-none">
      {dragSession && dragSession.kind === "internal" ? <TreeDragOverlay session={dragSession} /> : null}

      <div className="absolute inset-0 min-w-0" style={mode !== "changes" ? { display: "none" } : undefined}>
        <WorkspaceChangesPanel
          workspaceRoot={workspaceRoot}
          workspaceId={workspaceId}
          workspaceLabel={workspaceTreeLabel}
        />
      </div>

      <div className="absolute inset-0 flex min-w-0 flex-col" style={mode !== "files" ? { display: "none" } : undefined}>
        <FileTreeToolbar
          workspaceTreeLabel={workspaceTreeLabel}
          onCreateFile={handleCreateFile}
          onCreateFolder={handleCreateFolder}
          onRefreshExplorer={refreshTree}
          onCollapseAll={handleCollapseAll}
        />
        <ContextMenu open={contextMenu !== null} onOpenChange={handleContextMenuOpenChange}>
          <ContextMenuTrigger
            className="relative min-h-0 flex-1"
            onContextMenuCapture={handleTreeContextMenuCapture}
          >
          <FlatFileTree
            workspaceId={workspaceId}
            workspaceRoot={workspaceRoot}
            activePath={activePath}
            decorationIndex={decorationIndex}
            targetDirectory={targetDirectory}
            highlightedLeafDirectory={highlightedLeafDirectory}
            isHoverSuppressed={isHoverSuppressed}
            pendingCreate={pendingCreate}
            pendingRename={pendingRename}
            onContainerRef={handleContainerRef}
            onFileOpen={handleFileOpen}
            onRowPointerDown={onRowPointerDown}
            onRowClickCapture={onRowClickCapture}
            onRowSelect={handleRowSelect}
            onConfirmCreate={handleConfirmCreate}
            onCancelCreate={handleCancelCreate}
            onConfirmRename={handleConfirmRename}
            onCancelRename={handleCancelRename}
            onKeyDown={handleTreeKeyDown}
            onDragEnter={handleTreeDragEnter}
            onDragOver={handleTreeDragOver}
            onDragLeave={handleTreeDragLeave}
            onDrop={handleTreeDrop}
          />
          </ContextMenuTrigger>

          {contextMenu ? (
            <ContextMenuContent side="right" align="start" className="min-w-[200px]">
              {contextMenu.kind !== "root" ? (
                <>
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>Open in</ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {(availableEditors ?? [])
                        .filter((e) => e.category !== "utility")
                        .map((editor) => (
                          <ContextMenuItem
                            key={editor.id}
                            onClick={() => {
                              const absPath = contextMenu.relPath
                                ? `${workspaceRoot}/${contextMenu.relPath}`
                                : workspaceRoot;
                              invoke("open_in_app", { path: absPath, appId: editor.id }).catch(() => {});
                            }}
                          >
                            {editor.displayName}
                          </ContextMenuItem>
                        ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={handleContextMenuCopyRelativePath}>
                    Copy Relative Path
                  </ContextMenuItem>
                  <ContextMenuItem onClick={handleContextMenuCopyPath}>Copy Path</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={handleContextMenuCopy}>Copy</ContextMenuItem>
                  <ContextMenuItem onClick={handleRenameEntry}>Rename</ContextMenuItem>
                </>
              ) : null}
              <ContextMenuItem onClick={handleContextMenuPaste}>Paste</ContextMenuItem>
              {contextMenu.kind !== "root" ? (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onClick={handleContextMenuDelete}>
                    Delete
                  </ContextMenuItem>
                </>
              ) : null}
            </ContextMenuContent>
          ) : null}
        </ContextMenu>
      </div>
    </div>
  );
});
