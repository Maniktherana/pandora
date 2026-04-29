import { getIpcClient } from "@/services/ipc/ipc-lifecycle";
import { useFileTreeStore } from "./file-tree-store";
import { persistFileTreeExpandedPaths } from "./file-tree-preferences";

const COMMIT_DELAY_MS = 250;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function commit(scopeId: string): void {
  const paths =
    useFileTreeStore.getState().byScopeId[scopeId]?.expandedPaths ?? new Set<string>();
  persistFileTreeExpandedPaths(scopeId, paths).catch(console.error);
  getIpcClient()?.fileTreeSetExpandedPaths(scopeId, Array.from(paths)).catch(console.error);
}

/**
 * Trailing-debounce committer for file tree expansion state.
 *
 * Spam-clicking directories updates the store immediately for every click.
 * This committer ensures that persistence and IPC only fire once — after the
 * user stops changing the expansion, after a short delay.
 */
export const fileTreeExpansionCommitter = {
  schedule(scopeId: string): void {
    const existing = timers.get(scopeId);
    if (existing !== undefined) clearTimeout(existing);
    timers.set(
      scopeId,
      setTimeout(() => {
        timers.delete(scopeId);
        commit(scopeId);
      }, COMMIT_DELAY_MS),
    );
  },

  flush(scopeId: string): void {
    const existing = timers.get(scopeId);
    if (existing !== undefined) {
      clearTimeout(existing);
      timers.delete(scopeId);
    }
    commit(scopeId);
  },
};
