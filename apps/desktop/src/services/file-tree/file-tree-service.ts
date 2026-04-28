import { runtimeGateway } from "@/services/runtime/runtime-gateway";
import { useFileTreeStore } from "@/services/file-tree/file-tree-store";
import {
  loadFileTreeExpandedPaths,
  persistFileTreeExpandedPaths,
} from "@/services/file-tree/file-tree-preferences";
import {
  pendingFileTreeReads,
  pendingFileTreeWrites,
} from "@/services/file-tree/file-tree-request-registry";

const subscribedRuntimeIds = new Set<string>();

/**
 * Load persisted expansion, apply to store, and subscribe the runtime.
 * Always resolves — errors fall back to subscribing without paths.
 */
export async function fileTreeInitExpansion(runtimeId: string): Promise<void> {
  const current = useFileTreeStore.getState().byRuntimeId[runtimeId];
  if (current && subscribedRuntimeIds.has(runtimeId)) {
    return;
  }
  const client = runtimeGateway.getClient();
  if (!client) return;
  try {
    const paths = current
      ? Array.from(current.expandedPaths)
      : await loadFileTreeExpandedPaths(runtimeId);
    if (!current) {
      useFileTreeStore.getState().setExpandedPaths(runtimeId, new Set(paths));
    }
    subscribedRuntimeIds.add(runtimeId);
    void client.fileTreeSubscribe(runtimeId, paths).catch(() => {
      subscribedRuntimeIds.delete(runtimeId);
    });
  } catch {
    subscribedRuntimeIds.add(runtimeId);
    void client.fileTreeSubscribe(runtimeId).catch(() => {
      subscribedRuntimeIds.delete(runtimeId);
    });
  }
}

/** Persist the current expanded paths for a runtime to local storage. */
export function fileTreeFlushExpansion(runtimeId: string): void {
  const paths =
    useFileTreeStore.getState().byRuntimeId[runtimeId]?.expandedPaths ?? new Set<string>();
  void persistFileTreeExpandedPaths(runtimeId, paths);
}

export function fileTreeSetPathExpanded(
  runtimeId: string,
  relPath: string,
  expanded: boolean,
  persistNow: boolean,
): void {
  const current =
    useFileTreeStore.getState().byRuntimeId[runtimeId]?.expandedPaths ?? new Set<string>();
  const next = new Set(current);
  if (expanded) next.add(relPath);
  else next.delete(relPath);
  useFileTreeStore.getState().setExpandedPaths(runtimeId, next);
  if (persistNow) {
    void persistFileTreeExpandedPaths(runtimeId, next);
  }
  void runtimeGateway.getClient()?.fileTreeSetExpandedPaths(runtimeId, Array.from(next));
}

export function fileTreeSetAllExpandedPaths(
  runtimeId: string,
  paths: Set<string>,
  persistNow: boolean,
): void {
  useFileTreeStore.getState().setExpandedPaths(runtimeId, paths);
  if (persistNow) {
    void persistFileTreeExpandedPaths(runtimeId, paths);
  }
  void runtimeGateway.getClient()?.fileTreeSetExpandedPaths(runtimeId, Array.from(paths));
}

export function fileTreeRefresh(runtimeId: string, path?: string): void {
  void runtimeGateway.getClient()?.fileTreeRefresh(runtimeId, path);
}

export function fileTreeCreateFile(
  runtimeId: string,
  parentRelPath: string,
  name: string,
  contents = "",
): void {
  void runtimeGateway.getClient()?.fileTreeCreateFile(runtimeId, parentRelPath, name, contents);
}

export function fileTreeCreateDirectory(runtimeId: string, relativePath: string): void {
  void runtimeGateway.getClient()?.fileTreeCreateDirectory(runtimeId, relativePath);
}

export function fileTreeRename(runtimeId: string, sourceRelPath: string, newName: string): void {
  void runtimeGateway.getClient()?.fileTreeRename(runtimeId, sourceRelPath, newName);
}

export function fileTreeDelete(runtimeId: string, relativePath: string): void {
  void runtimeGateway.getClient()?.fileTreeDelete(runtimeId, relativePath);
}

export function fileTreeMove(
  runtimeId: string,
  sourceRelPath: string,
  destRelPath: string,
): void {
  void runtimeGateway.getClient()?.fileTreeMove(runtimeId, sourceRelPath, destRelPath);
}

export function fileTreeCopy(
  runtimeId: string,
  sourceRelPath: string,
  destRelPath: string,
): void {
  void runtimeGateway.getClient()?.fileTreeCopy(runtimeId, sourceRelPath, destRelPath);
}

export function fileTreeImport(
  runtimeId: string,
  destRelPath: string,
  sourcePaths: string[],
): void {
  void runtimeGateway.getClient()?.fileTreeImport(runtimeId, destRelPath, sourcePaths);
}

export function fileTreeReadTextFile(
  runtimeId: string,
  relativePath: string,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const client = runtimeGateway.getClient();
    if (!client) {
      reject(new Error("Runtime not connected"));
      return;
    }
    const requestID = crypto.randomUUID();
    pendingFileTreeReads.set(requestID, resolve);
    void client.fileTreeReadTextFile(runtimeId, requestID, relativePath).catch((err) => {
      pendingFileTreeReads.delete(requestID);
      reject(err as Error);
    });
  });
}

export function fileTreeWriteTextFile(
  runtimeId: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = runtimeGateway.getClient();
    if (!client) {
      reject(new Error("Runtime not connected"));
      return;
    }
    const requestID = crypto.randomUUID();
    pendingFileTreeWrites.set(requestID, (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
    void client.fileTreeWriteTextFile(runtimeId, requestID, relativePath, contents).catch((err) => {
      pendingFileTreeWrites.delete(requestID);
      reject(err as Error);
    });
  });
}
