import { getIpcClient } from "@/services/ipc/ipc-lifecycle";
import { useFileTreeStore } from "@/services/file-tree/file-tree-store";
import { loadFileTreeExpandedPaths } from "@/services/file-tree/file-tree-preferences";
import {
  pendingFileTreeReads,
  pendingFileTreeWrites,
} from "@/services/file-tree/file-tree-request-registry";
import { fileTreeExpansionCommitter } from "@/services/file-tree/file-tree-expansion-committer";

const subscribedScopeIds = new Set<string>();

export async function fileTreeInitExpansion(scopeId: string): Promise<void> {
  const current = useFileTreeStore.getState().byScopeId[scopeId];
  if (current?.bootStatus === "loaded" && subscribedScopeIds.has(scopeId)) {
    return;
  }

  useFileTreeStore.getState().setBootLoading(scopeId);

  const client = getIpcClient();
  if (!client) return;
  try {
    const paths = current
      ? Array.from(current.expandedPaths)
      : await loadFileTreeExpandedPaths(scopeId);
    if (!current) {
      useFileTreeStore.getState().setExpandedPaths(scopeId, new Set(paths));
    }
    subscribedScopeIds.add(scopeId);
    client.fileTreeSubscribe(scopeId, paths).catch(() => {
      subscribedScopeIds.delete(scopeId);
    });
  } catch {
    subscribedScopeIds.add(scopeId);
    client.fileTreeSubscribe(scopeId).catch(() => {
      subscribedScopeIds.delete(scopeId);
    });
  }
}

export const fileTreeService = {
  ensureSubscribed: fileTreeInitExpansion,

  setExpanded(scopeId: string, relPath: string, expanded: boolean): void {
    useFileTreeStore.getState().toggleExpanded(scopeId, relPath, expanded);
    fileTreeExpansionCommitter.schedule(scopeId);
  },

  setExpandedPaths(scopeId: string, paths: Set<string>): void {
    useFileTreeStore.getState().setExpandedPaths(scopeId, paths);
    fileTreeExpansionCommitter.schedule(scopeId);
  },

  flushExpansion(scopeId: string): void {
    fileTreeExpansionCommitter.flush(scopeId);
  },

  refresh(scopeId: string, path?: string): void {
    getIpcClient()?.fileTreeRefresh(scopeId, path).catch(console.error);
  },

  createFile(scopeId: string, parentRelPath: string, name: string, contents = ""): void {
    getIpcClient()?.fileTreeCreateFile(scopeId, parentRelPath, name, contents).catch(console.error);
  },

  createDirectory(scopeId: string, relativePath: string): void {
    getIpcClient()?.fileTreeCreateDirectory(scopeId, relativePath).catch(console.error);
  },

  rename(scopeId: string, sourceRelPath: string, newName: string): void {
    getIpcClient()?.fileTreeRename(scopeId, sourceRelPath, newName).catch(console.error);
  },

  delete(scopeId: string, relativePath: string): void {
    getIpcClient()?.fileTreeDelete(scopeId, relativePath).catch(console.error);
  },

  move(scopeId: string, sourceRelPath: string, destRelPath: string): void {
    getIpcClient()?.fileTreeMove(scopeId, sourceRelPath, destRelPath).catch(console.error);
  },

  copy(scopeId: string, sourceRelPath: string, destRelPath: string): void {
    getIpcClient()?.fileTreeCopy(scopeId, sourceRelPath, destRelPath).catch(console.error);
  },

  importFiles(scopeId: string, destRelPath: string, sourcePaths: string[]): void {
    getIpcClient()?.fileTreeImport(scopeId, destRelPath, sourcePaths).catch(console.error);
  },

  readTextFile(scopeId: string, relativePath: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const client = getIpcClient();
      if (!client) {
        reject(new Error("IPC client not available"));
        return;
      }
      const requestID = crypto.randomUUID();
      pendingFileTreeReads.set(requestID, resolve);
      client.fileTreeReadTextFile(scopeId, requestID, relativePath).catch((err) => {
        pendingFileTreeReads.delete(requestID);
        reject(err as Error);
      });
    });
  },

  writeTextFile(scopeId: string, relativePath: string, contents: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = getIpcClient();
      if (!client) {
        reject(new Error("IPC client not available"));
        return;
      }
      const requestID = crypto.randomUUID();
      pendingFileTreeWrites.set(requestID, (error?: Error) => {
        if (error) reject(error);
        else resolve();
      });
      client.fileTreeWriteTextFile(scopeId, requestID, relativePath, contents).catch((err) => {
        pendingFileTreeWrites.delete(requestID);
        reject(err as Error);
      });
    });
  },
};

export function fileTreeRefresh(scopeId: string, path?: string): void {
  fileTreeService.refresh(scopeId, path);
}

export function fileTreeReadTextFile(
  scopeId: string,
  relativePath: string,
): Promise<string | null> {
  return fileTreeService.readTextFile(scopeId, relativePath);
}

export function fileTreeWriteTextFile(
  scopeId: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  return fileTreeService.writeTextFile(scopeId, relativePath, contents);
}
