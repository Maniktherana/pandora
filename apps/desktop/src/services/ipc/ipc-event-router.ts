import { applyEditorRuntimeEvent, isEditorEvent } from "@/services/editor/editor-events";
import { applyFileTreeRuntimeEvent, isFileTreeEvent } from "@/services/file-tree/file-tree-events";
import {
  applyGitSnapshot,
  applyGitRefreshing,
  applyGitError,
  applyGitSummary,
} from "@/services/git/git-events";
import { ipcEventBus } from "@/services/ipc/ipc-event-queue";
import {
  applyTerminalRuntimeEvent,
  type TerminalEventHandlerContext,
} from "@/services/terminal/terminal-events";
import type { IpcQueueEvent } from "@/services/ipc/ipc-event-queue";

export type IpcEventRouterContext = TerminalEventHandlerContext;

function isGitProtocolEvent(event: IpcQueueEvent): boolean {
  return (
    event.type === "scm_snapshot" ||
    event.type === "scm_refreshing" ||
    event.type === "scm_operation_started" ||
    event.type === "scm_error"
  );
}

function applyGitProtocolEvent(event: IpcQueueEvent): void {
  switch (event.type) {
    case "scm_snapshot":
      applyGitSnapshot(event.scopeId, event.snapshot);
      applyGitSummary(event.scopeId, event.snapshot);
      break;
    case "scm_refreshing":
      applyGitRefreshing(event.scopeId);
      break;
    case "scm_operation_started":
      break;
    case "scm_error":
      applyGitError(event.scopeId, event.message);
      break;
  }
}

export function subscribeIpcEvents(ctx: IpcEventRouterContext): () => void {
  return ipcEventBus.subscribe((event) => {
    if (event.scopeId === "__settings_terminal__") return;
    if (isFileTreeEvent(event)) {
      applyFileTreeRuntimeEvent(event);
      return;
    }
    if (isGitProtocolEvent(event)) {
      applyGitProtocolEvent(event);
      return;
    }
    if (isEditorEvent(event)) {
      applyEditorRuntimeEvent(event);
      return;
    }
    applyTerminalRuntimeEvent(event, ctx);
  });
}
