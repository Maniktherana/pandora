import { useCallback, useEffect, useRef } from "react";
import {
  fileTreeInitExpansion,
  fileTreeFlushExpansion,
  fileTreeSetPathExpanded,
  fileTreeSetAllExpandedPaths,
  fileTreeRefresh,
  fileTreeCreateFile,
  fileTreeCreateDirectory,
  fileTreeRename,
  fileTreeDelete,
  fileTreeMove,
  fileTreeCopy,
  fileTreeImport,
  fileTreeReadTextFile,
  fileTreeWriteTextFile,
} from "@/services/file-tree/file-tree-service";

export function useFileTreeController(runtimeId: string) {
  const expansionLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    expansionLoadedRef.current = false;

    void fileTreeInitExpansion(runtimeId).then(() => {
      if (!cancelled) expansionLoadedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [runtimeId]);

  useEffect(() => {
    const id = runtimeId;
    return () => {
      if (!expansionLoadedRef.current) return;
      fileTreeFlushExpansion(id);
    };
  }, [runtimeId]);

  const setPathExpanded = useCallback(
    (relPath: string, expanded: boolean) => {
      fileTreeSetPathExpanded(runtimeId, relPath, expanded, expansionLoadedRef.current);
    },
    [runtimeId],
  );

  const setAllExpandedPaths = useCallback(
    (paths: Set<string>) => {
      fileTreeSetAllExpandedPaths(runtimeId, paths, expansionLoadedRef.current);
    },
    [runtimeId],
  );

  const refresh = useCallback(
    (path?: string) => {
      fileTreeRefresh(runtimeId, path);
    },
    [runtimeId],
  );

  const createFile = useCallback(
    (parentRelPath: string, name: string, contents = "") => {
      fileTreeCreateFile(runtimeId, parentRelPath, name, contents);
    },
    [runtimeId],
  );

  const createDirectory = useCallback(
    (relativePath: string) => {
      fileTreeCreateDirectory(runtimeId, relativePath);
    },
    [runtimeId],
  );

  const rename = useCallback(
    (sourceRelPath: string, newName: string) => {
      fileTreeRename(runtimeId, sourceRelPath, newName);
    },
    [runtimeId],
  );

  const deleteEntry = useCallback(
    (relativePath: string) => {
      fileTreeDelete(runtimeId, relativePath);
    },
    [runtimeId],
  );

  const move = useCallback(
    (sourceRelPath: string, destRelPath: string) => {
      fileTreeMove(runtimeId, sourceRelPath, destRelPath);
    },
    [runtimeId],
  );

  const copy = useCallback(
    (sourceRelPath: string, destRelPath: string) => {
      fileTreeCopy(runtimeId, sourceRelPath, destRelPath);
    },
    [runtimeId],
  );

  const importFiles = useCallback(
    (destRelPath: string, sourcePaths: string[]) => {
      fileTreeImport(runtimeId, destRelPath, sourcePaths);
    },
    [runtimeId],
  );

  const readTextFile = useCallback(
    (relativePath: string): Promise<string | null> =>
      fileTreeReadTextFile(runtimeId, relativePath),
    [runtimeId],
  );

  const writeTextFile = useCallback(
    (relativePath: string, contents: string): Promise<void> =>
      fileTreeWriteTextFile(runtimeId, relativePath, contents),
    [runtimeId],
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
