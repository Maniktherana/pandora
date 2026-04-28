import { useEditorStore } from "./editor-store";
import { pendingEditorReads, pendingEditorWrites } from "./editor-request-registry";
import type { RuntimeQueueEvent } from "@/services/runtime/runtime-event-queue";

export function isEditorEvent(
  event: RuntimeQueueEvent,
): event is Extract<
  RuntimeQueueEvent,
  {
    type:
      | "editor_file_read"
      | "editor_file_written"
      | "editor_file_changed"
      | "editor_error";
  }
> {
  return (
    event.type === "editor_file_read" ||
    event.type === "editor_file_written" ||
    event.type === "editor_file_changed" ||
    event.type === "editor_error"
  );
}

export function applyEditorRuntimeEvent(event: RuntimeQueueEvent): void {
  switch (event.type) {
    case "editor_file_read": {
      const resolver = pendingEditorReads.get(event.requestID);
      if (resolver) {
        pendingEditorReads.delete(event.requestID);
        resolver(event.contents);
      }
      break;
    }
    case "editor_file_written": {
      const resolver = pendingEditorWrites.get(event.requestID);
      if (resolver) {
        pendingEditorWrites.delete(event.requestID);
        resolver();
      }
      break;
    }
    case "editor_file_changed":
      useEditorStore
        .getState()
        .markDiskModified(event.runtimeId, event.relative_path);
      break;
    case "editor_error":
      if (event.requestID) {
        const readErr = pendingEditorReads.get(event.requestID);
        pendingEditorReads.delete(event.requestID);
        readErr?.(null);
        const writeErr = pendingEditorWrites.get(event.requestID);
        pendingEditorWrites.delete(event.requestID);
        writeErr?.(new Error(event.message));
      }
      break;
  }
}
