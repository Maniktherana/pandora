import { getWorkspaceSession } from "@/lib/services/layout/session";
import { removeTerminalSlotFromWorkspaceLayout } from "@/lib/services/layout/actions";
import {
  mutateWorkspaceLayout,
  updateWorkspaceLayout,
} from "@/lib/services/workspace/startup";

export function showWorkspaceTerminalTab(workspaceId: string, slotId: string): void {
  getWorkspaceSession(workspaceId, updateWorkspaceLayout, mutateWorkspaceLayout).commands.addTerminalTab(
    slotId,
  );
}

export function removeWorkspaceTerminalTab(workspaceId: string, slotId: string): void {
  removeTerminalSlotFromWorkspaceLayout(workspaceId, slotId);
}
