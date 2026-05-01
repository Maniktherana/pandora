import { removeTerminalSlotFromWorkspaceLayout } from "@/services/workspace/workspace-layout-model";
import { desktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";

export function showWorkspaceTerminalTab(scopeId: string, slotId: string): void {
  desktopWorkspaceService.getWorkspaceSession(scopeId).commands.addTerminalTab(slotId);
}

export function removeWorkspaceTerminalTab(scopeId: string, slotId: string): void {
  removeTerminalSlotFromWorkspaceLayout(scopeId, slotId);
}

export function showProjectTerminal(scopeId: string, slotId: string, index?: number): void {
  desktopWorkspaceService.addProjectTerminalGroup(scopeId, slotId, index);
}

export function setProjectTerminalPanelVisible(scopeId: string, visible: boolean): void {
  desktopWorkspaceService.setProjectTerminalPanelVisible(scopeId, visible);
}
