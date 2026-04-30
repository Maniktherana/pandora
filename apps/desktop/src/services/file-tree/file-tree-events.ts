import { useFileTreeStore } from "./file-tree-store";
import { applySnapshot, applyDirectoryChanged } from "./file-tree-model-registry";
import { pendingFileTreeReads, pendingFileTreeWrites } from "./file-tree-request-registry";
import type { IpcQueueEvent } from "@/services/ipc/ipc-event-queue";

export function isFileTreeEvent(
  event: IpcQueueEvent,
): event is Extract<
  IpcQueueEvent,
  {
    type:
      | "file_tree_snapshot"
      | "file_tree_directory_changed"
      | "file_tree_file_read"
      | "file_tree_file_written"
      | "file_tree_error";
  }
> {
  return (
    event.type === "file_tree_snapshot" ||
    event.type === "file_tree_directory_changed" ||
    event.type === "file_tree_file_read" ||
    event.type === "file_tree_file_written" ||
    event.type === "file_tree_error"
  );
}

export function applyFileTreeRuntimeEvent(event: IpcQueueEvent): void {
  switch (event.type) {
    case "file_tree_snapshot":
      useFileTreeStore.getState().setBooted(event.scopeId);
      applySnapshot(event.scopeId, event.snapshot.directories);
      break;
    case "file_tree_directory_changed":
      applyDirectoryChanged(event.scopeId, event.path, event.entries);
      break;
    case "file_tree_file_read": {
      const resolver = pendingFileTreeReads.get(event.requestID);
      if (resolver) {
        pendingFileTreeReads.delete(event.requestID);
        resolver(event.contents);
      }
      break;
    }
    case "file_tree_file_written": {
      const resolver = pendingFileTreeWrites.get(event.requestID);
      if (resolver) {
        pendingFileTreeWrites.delete(event.requestID);
        resolver();
      }
      break;
    }
    case "file_tree_error":
      if (event.requestID) {
        const readErr = pendingFileTreeReads.get(event.requestID);
        pendingFileTreeReads.delete(event.requestID);
        readErr?.(null);
        const writeErr = pendingFileTreeWrites.get(event.requestID);
        pendingFileTreeWrites.delete(event.requestID);
        writeErr?.(new Error(event.message));
      }
      useFileTreeStore.getState().setError(event.scopeId, event.message);
      break;
  }
}
