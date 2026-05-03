import { getIpcClient } from "@/lib/services/ipc/lifecycle";
import { useEditorStore } from "./store";
import { pendingEditorReads, pendingEditorWrites } from "./pending-requests";

/**
 * In-flight deduplication map for working-copy reads.
 * Key: workspaceId + "\0" + relativePath.
 * An in-flight promise is reused by concurrent callers for the same path so
 * the IPC bus is only hit once per path per flight.
 */
const inFlightWorkingCopyReads = new Map<string, Promise<string | null>>();

/**
 * Read the current working-copy content of a file without caching or
 * file-watcher side-effects in the editor store.  Suitable for diff/review
 * reads that must not depend on the file-tree service.
 *
 * Concurrent calls for the same (workspaceId, relativePath) pair are
 * deduplicated — only one IPC request is sent and all callers share its result.
 * Returns null if the file is missing or the runtime is unavailable.
 */
export function editorReadWorkingCopyText(
  workspaceId: string,
  relativePath: string,
): Promise<string | null> {
  const dedupeKey = `${workspaceId}\0${relativePath}`;
  const existing = inFlightWorkingCopyReads.get(dedupeKey);
  if (existing) return existing;

  const client = getIpcClient();
  if (!client) return Promise.resolve(null);

  const requestID = crypto.randomUUID();
  const promise = new Promise<string | null>((resolve, reject) => {
    pendingEditorReads.set(requestID, resolve);
    client
      .editorReadTextFile(workspaceId, requestID, relativePath)
      .catch((err: unknown) => {
        pendingEditorReads.delete(requestID);
        reject(err);
      });
  }).finally(() => {
    inFlightWorkingCopyReads.delete(dedupeKey);
  });

  inFlightWorkingCopyReads.set(dedupeKey, promise);
  return promise;
}

/**
 * Load file content from runtime into the editor store if not already cached.
 * Returns true if the file is now available, false if the load failed or runtime is unavailable.
 */
export async function editorEnsureFileLoaded(
  workspaceId: string,
  _workspaceRoot: string,
  relativePath: string,
): Promise<boolean> {
  const existing = useEditorStore.getState().bufferByWorkspace[workspaceId]?.[relativePath];
  if (existing !== undefined) return true;

  const client = getIpcClient();
  if (!client) return false;

  const requestID = crypto.randomUUID();
  try {
    const ok = await new Promise<boolean>((resolve, reject) => {
      pendingEditorReads.set(requestID, (content) => {
        if (content === null) {
          resolve(false);
          return;
        }
        useEditorStore.setState((s) => ({
          bufferByWorkspace: {
            ...s.bufferByWorkspace,
            [workspaceId]: {
              ...s.bufferByWorkspace[workspaceId],
              [relativePath]: content,
            },
          },
          savedContentByWorkspace: {
            ...s.savedContentByWorkspace,
            [workspaceId]: {
              ...s.savedContentByWorkspace[workspaceId],
              [relativePath]: content,
            },
          },
        }));
        resolve(true);
      });
      void client
        .editorReadTextFile(workspaceId, requestID, relativePath)
        .catch((err: unknown) => {
          pendingEditorReads.delete(requestID);
          reject(err);
        });
    });
    return ok;
  } catch (e) {
    console.error("Failed to open file:", e);
    return false;
  }
}

/**
 * Save a file to disk via the runtime.
 * If `content` is provided it's used directly; otherwise falls back to the store buffer.
 * Returns true on success.
 */
export async function editorSaveFile(
  workspaceId: string,
  _workspaceRoot: string,
  relativePath: string,
  content?: string,
): Promise<boolean> {
  const buf =
    content ?? useEditorStore.getState().bufferByWorkspace[workspaceId]?.[relativePath];
  if (buf === undefined) return false;

  const client = getIpcClient();
  if (!client) return false;

  const requestID = crypto.randomUUID();
  try {
    await new Promise<void>((resolve, reject) => {
      pendingEditorWrites.set(requestID, (error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        useEditorStore.setState((s) => ({
          bufferByWorkspace: {
            ...s.bufferByWorkspace,
            [workspaceId]: {
              ...s.bufferByWorkspace[workspaceId],
              [relativePath]: buf,
            },
          },
          savedContentByWorkspace: {
            ...s.savedContentByWorkspace,
            [workspaceId]: {
              ...s.savedContentByWorkspace[workspaceId],
              [relativePath]: buf,
            },
          },
          dirtyFlags: {
            ...s.dirtyFlags,
            [workspaceId]: { ...s.dirtyFlags[workspaceId], [relativePath]: false },
          },
        }));
        resolve();
      });
      void client
        .editorWriteTextFile(workspaceId, requestID, relativePath, buf)
        .catch((err: unknown) => {
          pendingEditorWrites.delete(requestID);
          reject(err);
        });
    });
    return true;
  } catch (e) {
    console.error("Failed to save file:", e);
    return false;
  }
}
