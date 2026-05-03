import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Ref,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFileTree, FileTree } from "@pierre/trees/react";
import type {
  ContextMenuItem as PierreContextMenuItem,
  ContextMenuOpenContext as PierreContextMenuOpenContext,
  FileTreeRenameEvent,
  FileTreeDropResult,
  FileTree as FileTreeModel,
} from "@pierre/trees";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getIpcClient } from "@/lib/services/ipc/lifecycle";
import { useFileTreeStore } from "@/lib/services/file-tree/store";
import {
  registerModel,
  unregisterModel,
  getInitialPaths,
  getDirectories,
  extractPaths,
} from "@/lib/services/file-tree/model-registry";
import { persistFileTreeExpandedPaths } from "@/lib/services/preferences/file-tree";
import {
  registerDecorationModel,
  unregisterDecorationModel,
  getInitialMergedStatus,
} from "@/lib/services/file-tree/decorations";
import { joinAbsolutePath } from "@/lib/shared/utils";
import DotGridLoader from "@/components/dot-grid-loader";

/** Map @pierre/trees CSS variable overrides to the app theme so file tree
 *  chrome and git-status colors stay in sync with the rest of the UI. */
const fileTreeThemeStyle: CSSProperties = {
  "--trees-bg-override": "var(--theme-bg)",
  "--trees-fg-override": "var(--theme-text-subtle)",
  "--trees-fg-muted-override": "var(--theme-text-muted)",
  "--trees-bg-muted-override": "var(--theme-panel-hover)",
  "--trees-accent-override": "var(--theme-interactive)",
  "--trees-border-color-override": "var(--theme-border)",
  "--trees-font-family-override": "var(--theme-font-sans)",
  "--trees-focus-ring-color-override": "var(--theme-interactive)",
  "--trees-selected-bg-override": "var(--theme-panel-hover)",
  "--trees-selected-fg-override": "var(--theme-text)",
  "--trees-selected-focused-border-color-override": "var(--theme-border)",
  "--trees-search-bg-override": "var(--theme-panel)",
  "--trees-search-fg-override": "var(--theme-text)",
  "--trees-input-bg-override": "var(--theme-panel)",
  "--trees-scrollbar-thumb-override": "var(--theme-scrollbar)",
  "--trees-status-added-override": "var(--theme-scm-added)",
  "--trees-status-modified-override": "var(--theme-scm-modified)",
  "--trees-status-deleted-override": "var(--theme-scm-deleted)",
  "--trees-status-renamed-override": "var(--theme-scm-renamed)",
  "--trees-status-untracked-override": "var(--theme-scm-added)",
  "--trees-status-ignored-override": "var(--theme-text-faint)",
} as CSSProperties;

function getParentPath(path: string): string {
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash < 0 ? "" : `${normalized.slice(0, lastSlash + 1)}`;
}

function getUniquePath(model: FileTreeModel, basePath: string): string {
  const hasCollision = (candidate: string): boolean => {
    if (model.getItem(candidate) != null) return true;
    const alt = candidate.endsWith("/") ? candidate.slice(0, -1) : `${candidate}/`;
    return model.getItem(alt) != null;
  };
  let suffix = 0;
  let candidate = basePath;
  while (hasCollision(candidate)) {
    suffix += 1;
    if (basePath.endsWith("/")) {
      candidate = `${basePath.slice(0, -1)}-${suffix}/`;
    } else {
      const dotIdx = basePath.lastIndexOf(".");
      const slashIdx = basePath.lastIndexOf("/");
      if (dotIdx > slashIdx) {
        candidate = `${basePath.slice(0, dotIdx)}-${suffix}${basePath.slice(dotIdx)}`;
      } else {
        candidate = `${basePath}-${suffix}`;
      }
    }
  }
  return candidate;
}

type FileTreeItem = NonNullable<ReturnType<FileTreeModel["getItem"]>>;
type FileTreeDirectoryItem = Extract<FileTreeItem, { isDirectory(): true }>;

function isDirectoryItem(item: FileTreeItem | null): item is FileTreeDirectoryItem {
  return item?.isDirectory() === true;
}

function strip(p: string): string {
  return p.endsWith("/") ? p.slice(0, -1) : p;
}

function anchorStyle(rect: PierreContextMenuOpenContext["anchorRect"]): CSSProperties {
  return {
    position: "fixed",
    left: rect.left,
    top: rect.bottom - 1,
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: "none",
    border: 0,
    padding: 0,
  };
}

export interface FileTreePanelHandle {
  createFile: () => void;
  createFolder: () => void;
  collapseAll: () => void;
}

export type FileTreePanelProps = {
  ref?: Ref<FileTreePanelHandle>;
  workspaceId: string;
  workspaceRoot: string;
  activePath: string | null;
  availableEditors: { id: string; displayName: string; category: string }[];
  onFileOpen: (workspaceId: string, workspaceRoot: string, path: string) => void;
};

export function FileTreePanel({
  ref,
  workspaceId,
  workspaceRoot,
  activePath,
  availableEditors,
  onFileOpen,
}: FileTreePanelProps) {
  const bootStatus = useFileTreeStore((s) => s.byScopeId[workspaceId]?.bootStatus ?? "idle");

  const stableRefs = useRef({ workspaceId, workspaceRoot, availableEditors, onFileOpen });
  stableRefs.current = { workspaceId, workspaceRoot, availableEditors, onFileOpen };

  const pendingCreateRef = useRef<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialPaths = useMemo(() => getInitialPaths(workspaceId), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialMergedStatus = useMemo(() => getInitialMergedStatus(workspaceId), []);

  const handleRename = useCallback((event: FileTreeRenameEvent) => {
    const { workspaceId: wid, workspaceRoot: wroot, onFileOpen: openFn } = stableRefs.current;
    const ipc = getIpcClient();
    if (!ipc) return;

    const pendingNorm = pendingCreateRef.current ? strip(pendingCreateRef.current) : null;
    const sourceNorm = strip(event.sourcePath);

    if (pendingNorm != null && pendingNorm === sourceNorm) {
      pendingCreateRef.current = null;
      if (event.isFolder) {
        ipc.fileTreeCreateDirectory(wid, strip(event.destinationPath)).catch(console.error);
      } else {
        const parentDir = strip(getParentPath(event.destinationPath));
        const name = event.destinationPath.split("/").pop() ?? event.destinationPath;
        ipc.fileTreeCreateFile(wid, parentDir, name, "").catch(console.error);
        openFn(wid, wroot, event.destinationPath);
      }
      ipc.fileTreeRefresh(wid).catch(console.error);
    } else {
      ipc.fileTreeRename(wid, strip(event.sourcePath), strip(event.destinationPath).split("/").pop() ?? event.destinationPath).catch(console.error);
    }
  }, []);

  const handleDrop = useCallback((event: FileTreeDropResult) => {
    const ipc = getIpcClient();
    if (!ipc) return;
    const destDir = strip(event.target.directoryPath ?? "");
    for (const path of event.draggedPaths) {
      ipc.fileTreeMove(stableRefs.current.workspaceId, strip(path), destDir).catch(console.error);
    }
  }, []);

  const { model } = useFileTree({
    paths: initialPaths,
    search: true,
    icons: "complete",
    density: "compact",
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    ...(activePath ? { initialSelectedPaths: [activePath] } : {}),
    onSelectionChange: (selected) => {
      const path = selected[0];
      if (!path) return;
      const handle = model.getItem(path);
      if (handle && !handle.isDirectory()) {
        const s = stableRefs.current;
        s.onFileOpen(s.workspaceId, s.workspaceRoot, path);
      }
    },
    renaming: { onRename: handleRename },
    dragAndDrop: { onDropComplete: handleDrop },
    gitStatus: initialMergedStatus,
  });

  useEffect(() => {
    registerModel(workspaceId, model);
    registerDecorationModel(workspaceId, model);
    return () => {
      unregisterModel(workspaceId);
      unregisterDecorationModel(workspaceId);
    };
  }, [workspaceId, model]);

  useEffect(() => {
    const getExpandedPaths = () => {
      const dirs = getDirectories(workspaceId);
      if (!dirs) return [];
      return extractPaths(dirs)
        .filter((path) => {
          if (!path.endsWith("/")) return false;
          const item = model.getItem(path);
          if (!isDirectoryItem(item)) return false;
          return item.isExpanded();
        })
        .sort();
    };

    let lastSerialized = JSON.stringify(getExpandedPaths());
    return model.subscribe(() => {
      const expandedPaths = getExpandedPaths();
      const nextSerialized = JSON.stringify(expandedPaths);
      if (nextSerialized === lastSerialized) return;
      lastSerialized = nextSerialized;
      persistFileTreeExpandedPaths(workspaceId, expandedPaths).catch(console.error);
    });
  }, [workspaceId, model]);

  useEffect(() => {
    if (activePath) model.focusNearestPath(activePath);
  }, [activePath, model]);

  const addEntry = useCallback((targetDir: string, kind: "file" | "folder") => {
    const template = kind === "folder" ? "untitled/" : "untitled";
    const nextPath = getUniquePath(model, `${targetDir}${template}`);
    pendingCreateRef.current = nextPath;
    model.add(nextPath);
    model.startRenaming(nextPath, { removeIfCanceled: true });
  }, [model]);

  const doCreateFile = useCallback(() => {
    const selected = model.getSelectedPaths();
    const path = selected[0] ?? "";
    const item = path ? model.getItem(path) : null;
    const targetDir = item?.isDirectory() ? (path.endsWith("/") ? path : `${path}/`) : getParentPath(path);
    addEntry(targetDir, "file");
  }, [model, addEntry]);

  const doCreateFolder = useCallback(() => {
    const selected = model.getSelectedPaths();
    const path = selected[0] ?? "";
    const item = path ? model.getItem(path) : null;
    const targetDir = item?.isDirectory() ? (path.endsWith("/") ? path : `${path}/`) : getParentPath(path);
    addEntry(targetDir, "folder");
  }, [model, addEntry]);

  const doCollapseAll = useCallback(() => {
    const dirs = getDirectories(stableRefs.current.workspaceId);
    if (!dirs) return;
    model.resetPaths(extractPaths(dirs), { initialExpandedPaths: [] });
  }, [model]);

  useImperativeHandle(ref, () => ({
    createFile: doCreateFile,
    createFolder: doCreateFolder,
    collapseAll: doCollapseAll,
  }), [doCreateFile, doCreateFolder, doCollapseAll]);

  const [ctxState, setCtxState] = useState<{
    item: PierreContextMenuItem;
    context: PierreContextMenuOpenContext;
  } | null>(null);

  const renderMenu = useCallback(
    (_item: PierreContextMenuItem, _ctx: PierreContextMenuOpenContext) => {
      queueMicrotask(() => setCtxState({ item: _item, context: _ctx }));
      return null;
    },
    [],
  );

  const closeMenu = useCallback(() => {
    const ctx = ctxState;
    setCtxState(null);
    ctx?.context.close();
  }, [ctxState]);

  const closeMenuNoFocus = useCallback(() => {
    const ctx = ctxState;
    setCtxState(null);
    ctx?.context.close({ restoreFocus: false });
  }, [ctxState]);

  const hasRegistryData = getInitialPaths(stableRefs.current.workspaceId).length > 0;
  if ((bootStatus === "idle" || bootStatus === "loading") && !hasRegistryData) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-4">
        <DotGridLoader variant="default" gridSize={5} sizeClassName="h-8 w-8" className="opacity-90" />
      </div>
    );
  }

  const ctxItem = ctxState?.item ?? null;
  const ctxContext = ctxState?.context ?? null;
  const editors = (stableRefs.current.availableEditors ?? []).filter((e) => e.category !== "utility");

  return (
    <>
      <FileTree
        model={model}
        data-file-tree-sidebar="true"
        className="h-full"
        style={fileTreeThemeStyle}
        renderContextMenu={renderMenu}
      />
      {ctxItem && ctxContext && (
        <DropdownMenu
          open
          onOpenChange={(open) => { if (!open) closeMenu(); }}
        >
          <DropdownMenuTrigger
            render={<button type="button" aria-hidden tabIndex={-1} />}
            style={anchorStyle(ctxContext.anchorRect)}
          />
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={4}
            className="min-w-[200px]"
          >
            {editors.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Open in</DropdownMenuSubTrigger>
                <DropdownMenuSubContent side="left">
                  {editors.map((editor) => (
                    <DropdownMenuItem
                      key={editor.id}
                      onClick={() => {
                        const absPath = joinAbsolutePath(stableRefs.current.workspaceRoot, ctxItem.path);
                        invoke("open_in_app", { path: absPath, appId: editor.id }).catch(() => {});
                        closeMenu();
                      }}
                    >
                      {editor.displayName}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => {
              const baseDir = ctxItem.kind === "directory" ? ctxItem.path : getParentPath(ctxItem.path);
              closeMenuNoFocus();
              addEntry(baseDir, "file");
            }}>
              New File
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const baseDir = ctxItem.kind === "directory" ? ctxItem.path : getParentPath(ctxItem.path);
              closeMenuNoFocus();
              addEntry(baseDir, "folder");
            }}>
              New Folder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              closeMenuNoFocus();
              model.startRenaming(ctxItem.path);
            }}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => {
              void navigator.clipboard.writeText(ctxItem.path);
              closeMenu();
            }}>
              Copy Relative Path
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              void navigator.clipboard.writeText(joinAbsolutePath(stableRefs.current.workspaceRoot, ctxItem.path));
              closeMenu();
            }}>
              Copy Path
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const absPath = joinAbsolutePath(stableRefs.current.workspaceRoot, ctxItem.path);
              void invoke("write_clipboard_file_paths", { paths: [absPath] }).catch(console.error);
              closeMenu();
            }}>
              Copy
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const destDir = strip(ctxItem.kind === "directory" ? ctxItem.path : getParentPath(ctxItem.path));
              void invoke<string[]>("read_clipboard_file_paths")
                .then((clipPaths) => { if (clipPaths.length > 0) getIpcClient()?.fileTreeImport(stableRefs.current.workspaceId, destDir, clipPaths).catch(console.error); })
                .catch(console.error);
              closeMenu();
            }}>
              Paste
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                getIpcClient()?.fileTreeDelete(stableRefs.current.workspaceId, strip(ctxItem.path)).catch(console.error);
                model.remove(ctxItem.path, ctxItem.kind === "directory" ? { recursive: true } : undefined);
                closeMenu();
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
}
