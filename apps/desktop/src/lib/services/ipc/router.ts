import { applyEditorRuntimeEvent, isEditorEvent } from "@/lib/services/editor/events";
import { applyFileTreeRuntimeEvent, isFileTreeEvent } from "@/lib/services/file-tree/events";
import { applyGitSnapshot, applyGitError } from "@/lib/services/git/events";
import { ipcEventBus } from "@/lib/services/ipc/events";
import {
  applyTerminalRuntimeEvent,
  type TerminalEventHandlerContext,
} from "@/lib/services/terminal/events";
import type { IpcQueueEvent } from "@/lib/services/ipc/events";

export type IpcEventRouterContext = TerminalEventHandlerContext;

function isGitProtocolEvent(event: IpcQueueEvent): boolean {
  return event.type === "scm_snapshot" || event.type === "scm_error";
}

function applyGitProtocolEvent(event: IpcQueueEvent): void {
  switch (event.type) {
    case "scm_snapshot":
      applyGitSnapshot(event.scopeId, event.snapshot);
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
