import { useCallback, useEffect } from "react";
import { fileTreeService } from "@/services/file-tree/file-tree-service";
import { useFileTreeStore } from "@/services/file-tree/file-tree-store";

/**
 * Exposes file tree actions for a given workspace scope.
 *
 * Subscription and boot are owned by workspace-startup-service.
 * This hook exposes action callbacks and flushes expansion on unmount.
 */
export function useFileTreeController(scopeId: string) {
  const bootStatus = useFileTreeStore((s) => s.byScopeId[scopeId]?.bootStatus ?? "idle");

  useEffect(() => {
    const id = scopeId;
    return () => {
      if (bootStatus === "loaded") {
        fileTreeService.flushExpansion(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeId]);

  const setPathExpanded = useCallback(
    (relPath: string, expanded: boolean) => {
      fileTreeService.setExpanded(scopeId, relPath, expanded);
    },
    [scopeId],
  );

  const setAllExpandedPaths = useCallback(
    (paths: Set<string>) => {
      fileTreeService.setExpandedPaths(scopeId, paths);
    },
    [scopeId],
  );

  const refresh = useCallback(
    (path?: string) => {
      fileTreeService.refresh(scopeId, path);
    },
    [scopeId],
  );

  const createFile = useCallback(
    (parentRelPath: string, name: string, contents = "") => {
      fileTreeService.createFile(scopeId, parentRelPath, name, contents);
    },
    [scopeId],
  );

  const createDirectory = useCallback(
    (relativePath: string) => {
      fileTreeService.createDirectory(scopeId, relativePath);
    },
    [scopeId],
  );

  const rename = useCallback(
    (sourceRelPath: string, newName: string) => {
      fileTreeService.rename(scopeId, sourceRelPath, newName);
    },
    [scopeId],
  );

  const deleteEntry = useCallback(
    (relativePath: string) => {
      fileTreeService.delete(scopeId, relativePath);
    },
    [scopeId],
  );

  const move = useCallback(
    (sourceRelPath: string, destRelPath: string) => {
      fileTreeService.move(scopeId, sourceRelPath, destRelPath);
    },
    [scopeId],
  );

  const copy = useCallback(
    (sourceRelPath: string, destRelPath: string) => {
      fileTreeService.copy(scopeId, sourceRelPath, destRelPath);
    },
    [scopeId],
  );

  const importFiles = useCallback(
    (destRelPath: string, sourcePaths: string[]) => {
      fileTreeService.importFiles(scopeId, destRelPath, sourcePaths);
    },
    [scopeId],
  );

  const readTextFile = useCallback(
    (relativePath: string): Promise<string | null> =>
      fileTreeService.readTextFile(scopeId, relativePath),
    [scopeId],
  );

  const writeTextFile = useCallback(
    (relativePath: string, contents: string): Promise<void> =>
      fileTreeService.writeTextFile(scopeId, relativePath, contents),
    [scopeId],
  );

  return {
    setPathExpanded,
    setAllExpandedPaths,
    refresh,
    createFile,
    createDirectory,
    rename,
    deleteEntry,
    move,
    copy,
    importFiles,
    readTextFile,
    writeTextFile,
  };
}
