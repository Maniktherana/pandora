import { useMemo } from "react";
import { runtimeGateway } from "@/services/runtime/runtime-gateway";
import { desktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";
import type { DesktopViewStateSnapshot } from "@/services/workspace/desktop-view-projections";

export function useWorkspaceActions() {
  return useMemo(
    () => ({
      loadDesktopState: () => void desktopWorkspaceService.loadDesktopState().catch(console.error),
      addProject: (path: string) =>
        void desktopWorkspaceService.addProject(path).catch(console.error),
      toggleProject: (projectId: string) =>
        void desktopWorkspaceService.toggleProject(projectId).catch(console.error),
      removeProject: (projectId: string) =>
        void desktopWorkspaceService.removeProject(projectId).catch(console.error),
      selectProject: (projectId: string) =>
        void desktopWorkspaceService.selectProject(projectId).catch(console.error),
      selectWorkspace: (workspaceId: string) =>
        void desktopWorkspaceService.selectWorkspace(workspaceId).catch(console.error),
      activateSidebarSelection: () =>
        void desktopWorkspaceService.activateSidebarSelection().catch(console.error),
      navigateSidebar: (offset: number) => desktopWorkspaceService.navigateSidebar(offset),
      switchWorkspaceRelative: (
        offset: number,
        navigationArea?: DesktopViewStateSnapshot["navigationArea"],
      ) =>
        void desktopWorkspaceService
          .switchWorkspaceRelative(offset, navigationArea)
          .catch(console.error),
      setNavigationArea: (area: DesktopViewStateSnapshot["navigationArea"]) =>
        desktopWorkspaceService.setNavigationArea(area),
      setSearchText: (text: string) => desktopWorkspaceService.setSearchText(text),
      setLayoutTargetRuntimeId: (runtimeId: string | null) =>
        desktopWorkspaceService.setLayoutTargetRuntimeId(runtimeId),
      createWorkspace: (projectId: string, workspaceKind?: "worktree" | "linked") =>
        void desktopWorkspaceService.createWorkspace(projectId, workspaceKind).catch(console.error),
      retryWorkspace: (workspaceId: string) =>
        void desktopWorkspaceService.retryWorkspace(workspaceId).catch(console.error),
      renameWorkspace: (workspaceId: string, name: string) =>
        void desktopWorkspaceService.renameWorkspace(workspaceId, name).catch(console.error),
      updateWorkspacePrState: (workspaceId: string, prState: string) =>
        desktopWorkspaceService.updateWorkspacePrState(workspaceId, prState),
      setPrAwaiting: (workspaceId: string, awaiting: boolean) =>
        desktopWorkspaceService.setPrAwaiting(workspaceId, awaiting),
      archiveWorkspace: (workspaceId: string, options?: { deleteWorktree?: boolean }) =>
        desktopWorkspaceService.archiveWorkspace(workspaceId, options),
      restoreWorkspace: (workspaceId: string) =>
        desktopWorkspaceService.restoreWorkspace(workspaceId),
      removeWorkspace: (workspaceId: string) =>
        desktopWorkspaceService.removeWorkspace(workspaceId),
      connectRuntime: () => void runtimeGateway.connect(),
      disconnectRuntime: () => runtimeGateway.disconnect(),
    }),
    [],
  );
}
