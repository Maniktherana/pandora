import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTabDrag } from "@/components/dnd/tab-drag-provider";
import WorkspaceChangesPanel from "@/components/layout/right-sidebar/scm/workspace-changes-panel";
import { FileTypeIcon } from "@/components/layout/right-sidebar/files/file-type-icon";
import { useRuntimeState } from "@/hooks/use-desktop-view";
import { cn, joinAbsolutePath } from "@/lib/shared/utils";
import {
  decorationForScmEntry,
  flattenScmSnapshot,
} from "@/services/scm/scm-utils";
import type { TreeScmDecoration } from "@/services/scm/scm-types";
import type { WorkspaceRuntimeState } from "@/lib/shared/types";
import { useFileTreeStore } from "@/services/file-tree/file-tree-store";
import { useScmStore } from "@/services/scm/scm-store";
import { useFileTreeController } from "@/services/file-tree/use-file-tree";
import { findLeaf } from "@/components/layout/workspace/layout-tree";
import type {
  LeftPanelMode,
  PendingCreateState,
  PendingRenameState,
  TreeRowKind,
} from "./files/files.types";
import { useEditorActions } from "@/hooks/use-editor-actions";
import { FileTreeRow } from "./files/file-tree-row";
import { DirectoryNode } from "./files/directory-node";
import { FileTreeToolbar } from "./files/file-tree-toolbar";
import { TreeCreateInput } from "./files/tree-create-input";
import { TreeRenameInput } from "./files/tree-rename-input";
import { TreeDragOverlay } from "./files/tree-drag-overlay";
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
import DotGridLoader from "@/components/dot-grid-loader";
import type { ScmEntry } from "@/lib/shared/types";
import { useFileTreeDrag } from "./use-file-tree-drag";
import { useFileTreeClipboard } from "./use-file-tree-clipboard";

const emptySet = new Set<string>();

function scoreTone(tone: TreeScmDecoration["tone"]): number {
  switch (tone) {
    case "conflict":
      return 5;
    case "deleted":
      return 4;
    case "modified":
      return 3;
    case "renamed":
      return 2;
    case "added":
      return 1;
    default:
      return 0;
  }
}

function createDecorationResolver(entries: ScmEntry[]) {
  const visibleEntries = entries.filter(
    (entry) => decorationForScmEntry(entry, { includeDeleted: false }).tone !== null,
  );
  const exact = new Map(
    visibleEntries.map((entry) => [
      entry.path,
      decorationForScmEntry(entry, { includeDeleted: false }),
    ]),
  );
  return (relPath: string, isDirectory: boolean, isIgnored?: boolean): TreeScmDecoration => {
    if (isIgnored) return { badge: null, tone: "ignored", dimmed: true };
    const hit = exact.get(relPath);
    if (hit) return hit;
    if (!isDirectory) return { badge: null, tone: null, dimmed: false };

    const prefix = `${relPath}/`;
    let winner: TreeScmDecoration = { badge: null, tone: null, dimmed: false };
    for (const entry of visibleEntries) {
      if (entry.path.startsWith(prefix) || entry.origPath?.startsWith(prefix)) {
        const next = decorationForScmEntry(entry, { includeDeleted: false });
        if (scoreTone(next.tone) > scoreTone(winner.tone)) {
          winner = next;
        }
      }
    }
    return winner;
  };
}

function RightSidebarPanelLoader() {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-4">
      <div className="flex flex-col items-center text-center text-[var(--theme-text-faint)]">
        <DotGridLoader
          variant="default"
          gridSize={5}
          sizeClassName="h-8 w-8"
          className="opacity-90"
        />
      </div>
    </div>
  );
}

function selectActiveEditorPath(runtime: WorkspaceRuntimeState | null): string | null {
  if (!runtime?.root || !runtime.focusedPaneID) return null;
  const leaf = findLeaf(runtime.root, runtime.focusedPaneID);
  if (!leaf) return null;
  const tab = leaf.tabs[leaf.selectedIndex] ?? leaf.tabs[0];
  if (!tab || (tab.kind !== "editor" && tab.kind !== "diff")) return null;
  return tab.path;
}

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
  const contextMenuWorkspaceRootRef = useRef(workspaceRoot);
  contextMenuWorkspaceRootRef.current = workspaceRoot;

  // Reset workspace-dependent state when workspace changes.
  useEffect(() => {
    setSelectedTreePath(null);
    setSelectedTreeKind(null);
    setPendingCreate(null);
    setPendingRename(null);
  }, [workspaceId]);

  const { openFile } = useEditorActions();
  const { startDrag } = useTabDrag();
  const activePath = useRuntimeState(workspaceId, selectActiveEditorPath);
  // File tree store + controller
  const fileTree = useFileTreeController(workspaceId);
  const rootEntries = useFileTreeStore(
    (s) => s.byRuntimeId[workspaceId]?.directories[""] ?? null,
  );
  const rootError = useFileTreeStore((s) => s.byRuntimeId[workspaceId]?.lastError ?? null);
  const expandedPaths = useFileTreeStore(
    (s) => s.byRuntimeId[workspaceId]?.expandedPaths ?? emptySet,
  );

  // SCM decorations
  const scmSnapshot = useScmStore((s) => s.byRuntimeId[workspaceId]?.snapshot ?? null);
  const scmEntries = useMemo(() => flattenScmSnapshot(scmSnapshot), [scmSnapshot]);
  const resolveDecoration = useMemo(() => createDecorationResolver(scmEntries), [scmEntries]);

  const isPathExpanded = useCallback(
    (relPath: string) =>
      useFileTreeStore.getState().byRuntimeId[workspaceId]?.expandedPaths.has(relPath) ?? false,
    [workspaceId],
  );

  const setPathExpanded = useCallback(
    (relPath: string, expanded: boolean) => {
      startTransition(() => {
        fileTree.setPathExpanded(relPath, expanded);
      });
    },
    [fileTree],
  );

  const refreshTree = useCallback(() => {
    fileTree.refresh();
  }, [fileTree]);

  const handleCollapseAll = useCallback(() => {
    fileTree.setAllExpandedPaths(new Set());
  }, [fileTree]);

  // Drag-and-drop
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
    expandedPaths,
    fileTree,
    startDrag,
    setSelectedTreePath,
    setSelectedTreeKind,
  });

  // Clipboard + context menu
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

  const handleCancelCreate = useCallback(() => {
    setPendingCreate(null);
  }, []);

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

  const handleCancelRename = useCallback(() => {
    setPendingRename(null);
  }, []);

  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden bg-[var(--theme-bg)] select-none">
      {dragSession && dragSession.kind === "internal" ? <TreeDragOverlay session={dragSession} /> : null}

      <div
        className={cn(
          "absolute inset-0 min-w-0",
          mode === "changes" ? "block" : "hidden",
        )}
        aria-hidden={mode !== "changes"}
      >
        <WorkspaceChangesPanel
          workspaceRoot={workspaceRoot}
          workspaceId={workspaceId}
          workspaceLabel={workspaceTreeLabel}
        />
      </div>

      <div
        className={cn(
          "absolute inset-0 flex min-w-0 flex-col",
          mode === "files" ? "flex" : "hidden",
        )}
        aria-hidden={mode !== "files"}
      >
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
              <div
                ref={treeBodyRef}
                data-file-tree-sidebar="true"
                tabIndex={-1}
                className="relative min-h-0 h-full overflow-auto overscroll-none px-1.5 pb-2 outline-none"
                style={{ overscrollBehavior: "none" }}
                onKeyDown={handleTreeKeyDown}
                onDragEnter={handleTreeDragEnter}
                onDragOver={handleTreeDragOver}
                onDragLeave={handleTreeDragLeave}
                onDrop={handleTreeDrop}
              >
                {rootEntries === null ? <RightSidebarPanelLoader /> : null}
                {rootError ? (
                  <div className="px-2 py-2 text-xs text-[var(--theme-error)]">{rootError}</div>
                ) : null}
                {rootEntries !== null && pendingCreate && pendingCreate.parentRelPath === "" && (
                  <TreeCreateInput
                    kind={pendingCreate.kind}
                    parentRelPath={pendingCreate.parentRelPath}
                    depth={0}
                    onConfirm={handleConfirmCreate}
                    onCancel={handleCancelCreate}
                  />
                )}
                {rootEntries?.map((entry) =>
                  pendingRename?.relPath === entry.name ? (
                    <TreeRenameInput
                      key={entry.name}
                      kind={entry.isDirectory ? "directory" : "file"}
                      depth={0}
                      initialName={pendingRename.currentName}
                      sourceRelPath={pendingRename.relPath}
                      onConfirm={handleConfirmRename}
                      onCancel={handleCancelRename}
                    />
                  ) : entry.isDirectory ? (
                    <DirectoryNode
                      key={entry.name}
                      workspaceRoot={workspaceRoot}
                      workspaceId={workspaceId}
                      relPath={entry.name}
                      parentRelPath=""
                      name={entry.name}
                      depth={0}
                      isIgnored={entry.isIgnored}
                      resolveDecoration={resolveDecoration}
                      isExpanded={isPathExpanded(entry.name)}
                      isPathExpanded={isPathExpanded}
                      setPathExpanded={setPathExpanded}
                      activePath={activePath}
                      highlightedLeafDirectory={highlightedLeafDirectory}
                      targetDirectory={targetDirectory}
                      isHoverSuppressed={isHoverSuppressed}
                      showDirectoryIcon={false}
                      directoryScmBadgeVariant="dot"
                      onRowPointerDown={onRowPointerDown}
                      onRowClickCapture={onRowClickCapture}
                      pendingCreate={pendingCreate}
                      onConfirmCreate={handleConfirmCreate}
                      onCancelCreate={handleCancelCreate}
                      pendingRename={pendingRename}
                      onConfirmRename={handleConfirmRename}
                      onCancelRename={handleCancelRename}
                    />
                  ) : (
                    <FileTreeRow
                      key={entry.name}
                      depth={0}
                      icon={<FileTypeIcon path={entry.name} kind="file" />}
                      label={entry.name}
                      decoration={resolveDecoration(entry.name, false, entry.isIgnored)}
                      active={activePath === entry.name}
                      onOpen={() => void openFile(workspaceId, workspaceRoot, entry.name)}
                      onPointerDown={onRowPointerDown}
                      onClickCapture={onRowClickCapture}
                      rowKind="file"
                      rowRelPath={entry.name}
                      parentRelPath=""
                      absolutePath={joinAbsolutePath(workspaceRoot, entry.name)}
                      highlightedLeafDirectory={highlightedLeafDirectory}
                      isHoverSuppressed={isHoverSuppressed}
                    />
                  ),
                )}
              </div>
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
                                invoke("open_in_app", { path: absPath, appId: editor.id }).catch(
                                  () => {},
                                );
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
