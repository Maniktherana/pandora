import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getParentRelPath, joinAbsolutePath } from "@/lib/shared/utils";
import type { PendingRenameState, TreeRowKind } from "./files/files.types";

interface UseFileTreeClipboardParams {
  workspaceRoot: string;
  fileTree: {
    copy: (sourceRelPath: string, destDir: string) => void;
    importFiles: (destDir: string, paths: string[]) => void;
    deleteEntry: (relPath: string) => void;
  };
  setPathExpanded: (relPath: string, expanded: boolean) => void;
  selectedTreePath: string | null;
  activePath: string | null;
  setPendingRename: (state: PendingRenameState) => void;
}

export interface UseFileTreeClipboardResult {
  contextMenu: { relPath: string; kind: TreeRowKind | "root" } | null;
  copiedPath: string | null;
  closeContextMenu: () => void;
  handleContextMenuOpenChange: (open: boolean) => void;
  handleTreeContextMenuCapture: (event: React.MouseEvent) => void;
  handleTreeKeyDown: (event: React.KeyboardEvent) => void;
  handleRenameEntry: () => void;
  handleContextMenuCopyRelativePath: () => void;
  handleContextMenuCopyPath: () => void;
  handleContextMenuCopy: () => void;
  handleContextMenuPaste: () => void;
  handleContextMenuDelete: () => void;
}

export function useFileTreeClipboard({
  workspaceRoot,
  fileTree,
  setPathExpanded,
  selectedTreePath,
  activePath,
  setPendingRename,
}: UseFileTreeClipboardParams): UseFileTreeClipboardResult {
  const [contextMenu, setContextMenu] = useState<{
    relPath: string;
    kind: TreeRowKind | "root";
  } | null>(null);
  const contextMenuActionRef = useRef(contextMenu);
  contextMenuActionRef.current = contextMenu;

  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open) closeContextMenu();
    },
    [closeContextMenu],
  );

  const handleTreeContextMenuCapture = useCallback((event: React.MouseEvent) => {
    const hit = (event.target as Element).closest?.("[data-tree-row-path]") as HTMLElement | null;
    if (!hit) {
      setContextMenu({ relPath: "", kind: "root" });
      return;
    }
    const relPath = hit.dataset.treeRowPath ?? "";
    const rawKind = hit.dataset.treeRowKind;
    const kind: TreeRowKind =
      rawKind === "directory" ? "directory" : rawKind === "file" ? "file" : "file";
    if (!relPath) {
      setContextMenu({ relPath: "", kind: "root" });
      return;
    }
    setContextMenu({ relPath, kind });
  }, []);

  const handleTreeKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const path = selectedTreePath ?? activePath;
      if (!path) return;

      if (event.key === "Backspace" && event.metaKey) {
        event.preventDefault();
        fileTree.deleteEntry(path);
        return;
      }

      if (event.key === "c" && event.metaKey && !event.shiftKey) {
        event.preventDefault();
        setCopiedPath(path);
        const abs = joinAbsolutePath(workspaceRoot, path);
        void invoke("write_clipboard_file_paths", { paths: [abs] }).catch(console.error);
        return;
      }

      if (event.key === "v" && event.metaKey && !event.shiftKey) {
        event.preventDefault();
        const destDir = getParentRelPath(path);
        void invoke<string[]>("read_clipboard_file_paths")
          .then((clipPaths) => {
            if (clipPaths.length > 0) {
              fileTree.importFiles(destDir, clipPaths);
              return;
            }
            if (copiedPath) {
              fileTree.copy(copiedPath, destDir);
            }
          })
          .catch(console.error);
        return;
      }
    },
    [activePath, copiedPath, fileTree, selectedTreePath, workspaceRoot],
  );

  const handleRenameEntry = useCallback(() => {
    const cm = contextMenuActionRef.current;
    if (!cm || cm.kind === "root") return;
    const sourceRelPath = cm.relPath;
    const parts = sourceRelPath.split("/");
    if (parts.length > 1) {
      let acc = parts[0];
      setPathExpanded(acc ?? "", true);
      for (let i = 1; i < parts.length - 1; i++) {
        acc = `${acc}/${parts[i]}`;
        setPathExpanded(acc, true);
      }
    }
    const currentName = parts[parts.length - 1] ?? sourceRelPath;
    setPendingRename({
      kind: cm.kind,
      relPath: sourceRelPath,
      parentRelPath: getParentRelPath(sourceRelPath),
      currentName,
    });
    setContextMenu(null);
  }, [setPendingRename, setPathExpanded]);

  const handleContextMenuCopyRelativePath = useCallback(() => {
    const cm = contextMenuActionRef.current;
    if (!cm || cm.kind === "root") return;
    void navigator.clipboard.writeText(cm.relPath);
    closeContextMenu();
  }, [closeContextMenu]);

  const handleContextMenuCopyPath = useCallback(() => {
    const cm = contextMenuActionRef.current;
    if (!cm || cm.kind === "root") return;
    void navigator.clipboard.writeText(joinAbsolutePath(workspaceRoot, cm.relPath));
    closeContextMenu();
  }, [closeContextMenu, workspaceRoot]);

  const handleContextMenuCopy = useCallback(() => {
    const cm = contextMenuActionRef.current;
    if (!cm || cm.kind === "root") return;
    setCopiedPath(cm.relPath);
    const abs = joinAbsolutePath(workspaceRoot, cm.relPath);
    void invoke("write_clipboard_file_paths", { paths: [abs] }).catch(console.error);
    closeContextMenu();
  }, [closeContextMenu, workspaceRoot]);

  const handleContextMenuPaste = useCallback(() => {
    const cm = contextMenuActionRef.current;
    if (!cm) return;
    const destDir =
      cm.kind === "directory"
        ? cm.relPath
        : cm.kind === "root"
          ? ""
          : getParentRelPath(cm.relPath);
    void invoke<string[]>("read_clipboard_file_paths")
      .then((clipPaths) => {
        if (clipPaths.length > 0) {
          fileTree.importFiles(destDir, clipPaths);
          return;
        }
        if (copiedPath) {
          fileTree.copy(copiedPath, destDir);
        }
      })
      .catch(console.error);
    closeContextMenu();
  }, [closeContextMenu, copiedPath, fileTree]);

  const handleContextMenuDelete = useCallback(() => {
    const cm = contextMenuActionRef.current;
    if (!cm || cm.kind === "root") return;
    fileTree.deleteEntry(cm.relPath);
    closeContextMenu();
  }, [closeContextMenu, fileTree]);

  return {
    contextMenu,
    copiedPath,
    closeContextMenu,
    handleContextMenuOpenChange,
    handleTreeContextMenuCapture,
    handleTreeKeyDown,
    handleRenameEntry,
    handleContextMenuCopyRelativePath,
    handleContextMenuCopyPath,
    handleContextMenuCopy,
    handleContextMenuPaste,
    handleContextMenuDelete,
  };
}
