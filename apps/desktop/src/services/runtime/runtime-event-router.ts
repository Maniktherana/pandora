import type { RuntimeQueueEvent } from "./runtime-event-queue";
import { isFileTreeEvent, applyFileTreeRuntimeEvent } from "@/services/file-tree/file-tree-events";
import { isScmEvent, applyScmRuntimeEvent } from "@/services/scm/scm-events";
import { isEditorEvent, applyEditorRuntimeEvent } from "@/services/editor/editor-events";
import type { WorkspaceRuntimeEventContext } from "@/services/workspace/workspace-runtime-events";
import { applyWorkspaceRuntimeEvent } from "@/services/workspace/workspace-runtime-events";

export function routeRuntimeEvent(
  event: RuntimeQueueEvent,
  workspaceCtx: WorkspaceRuntimeEventContext,
): Promise<void> | void {
  if (isFileTreeEvent(event)) return applyFileTreeRuntimeEvent(event);
  if (isScmEvent(event)) return applyScmRuntimeEvent(event);
  if (isEditorEvent(event)) return applyEditorRuntimeEvent(event);
  return applyWorkspaceRuntimeEvent(event, workspaceCtx);
}
