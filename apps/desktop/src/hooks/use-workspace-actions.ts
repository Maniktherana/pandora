import { useMemo } from "react";
import { workspaceActions } from "@/lib/services/workspace/actions";
import type { NavigationArea } from "@/lib/services/navigation/store";

export function useWorkspaceActions() {
  return useMemo(
    () => ({
      loadDesktopState: () => void workspaceActions.loadDesktopState().catch(console.error),
      addProject: (path: string) =>
        void workspaceActions.addProject(path).catch(console.error),
      toggleProject: (projectId: string) =>
        void workspaceActions.toggleProject(projectId).catch(console.error),
      removeProject: (projectId: string) =>
        void workspaceActions.removeProject(projectId).catch(console.error),
      selectProject: (projectId: string) =>
        void workspaceActions.selectProject(projectId).catch(console.error),
      selectWorkspace: (workspaceId: string) =>
        void workspaceActions.selectWorkspace(workspaceId).catch(console.error),
      activateSidebarSelection: () =>
        void workspaceActions.activateSidebarSelection().catch(console.error),
      navigateSidebar: (offset: number) => workspaceActions.navigateSidebar(offset),
      switchWorkspaceRelative: (offset: number, navigationArea?: NavigationArea) =>
        void workspaceActions
          .switchWorkspaceRelative(offset, navigationArea)
          .catch(console.error),
      setNavigationArea: (area: NavigationArea) =>
        workspaceActions.setNavigationArea(area),
      setSearchText: (text: string) => workspaceActions.setSearchText(text),
      setLayoutTargetScopeId: (scopeId: string | null) =>
        workspaceActions.setLayoutTargetScopeId(scopeId),
      createWorkspace: (projectId: string, workspaceKind?: "worktree" | "linked") =>
        void workspaceActions.createWorkspace(projectId, workspaceKind).catch(console.error),
      retryWorkspace: (workspaceId: string) =>
        void workspaceActions.retryWorkspace(workspaceId).catch(console.error),
      renameWorkspace: (workspaceId: string, name: string) =>
        void workspaceActions.renameWorkspace(workspaceId, name).catch(console.error),
      updateWorkspacePrState: (workspaceId: string, prState: string) =>
        workspaceActions.updateWorkspacePrState(workspaceId, prState),
      archiveWorkspace: (workspaceId: string, options?: { deleteWorktree?: boolean }) =>
        workspaceActions.archiveWorkspace(workspaceId, options),
      restoreWorkspace: (workspaceId: string) =>
        workspaceActions.restoreWorkspace(workspaceId),
      removeWorkspace: (workspaceId: string) =>
        workspaceActions.removeWorkspace(workspaceId),
    }),
    [],
  );
}
