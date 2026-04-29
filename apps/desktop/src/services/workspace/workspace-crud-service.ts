import type { WorkspaceKind, WorkspaceRecord } from "@/lib/shared/types";
import {
  applyAppState,
  patchWorkspaceRecord,
} from "@/services/workspace/desktop-view-service";
import { useCatalogStore } from "@/services/workspace/catalog-store";
import { useNavigationStore } from "@/services/workspace/navigation-store";
import { useLayoutStore } from "@/services/workspace/layout-store";
import { useTerminalScopeStore } from "@/services/terminal/terminal-scope-store";
import { DesktopStateLoadError, WorkspaceSelectionError } from "@/services/service-errors";
import {
  loadAppState,
  saveSelection,
  addProject as apiAddProject,
  toggleProject as apiToggleProject,
  removeProject as apiRemoveProject,
  createWorkspace as apiCreateWorkspace,
  archiveWorkspace as apiArchiveWorkspace,
  canArchiveWorkspace as apiCanArchiveWorkspace,
  restoreWorkspace as apiRestoreWorkspace,
  renameWorkspace as apiRenameWorkspace,
  removeWorkspace as apiRemoveWorkspace,
  retryWorkspace as apiRetryWorkspace,
} from "@/services/workspace/workspace-api";
import { useSettingsStore } from "@/services/settings/settings-store";
import type { createTerminalStartupService } from "@/services/terminal/terminal-startup-service";

// ─── utilities ────────────────────────────────────────────────────────────────

export function workspaceSelectionError(
  cause: unknown,
  workspaceId?: string,
): WorkspaceSelectionError {
  return new WorkspaceSelectionError({
    cause,
    ...(workspaceId === undefined ? {} : { workspaceId }),
  });
}

export function findNearestWorkspaceInProject(
  workspaces: readonly Pick<WorkspaceRecord, "id" | "projectId" | "status">[],
  workspaceId: string,
) {
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace || workspace.status === "archived") return null;

  const projectWorkspaces = workspaces.filter(
    (entry) => entry.projectId === workspace.projectId && entry.status !== "archived",
  );
  const projectIndex = projectWorkspaces.findIndex((entry) => entry.id === workspaceId);
  if (projectIndex < 0) return null;

  return (
    projectWorkspaces[projectIndex + 1] ?? projectWorkspaces[projectIndex - 1] ?? null
  );
}

// ─── context ──────────────────────────────────────────────────────────────────

export type WorkspaceCrudContext = {
  terminalStartup: ReturnType<typeof createTerminalStartupService>;
  resetWorkspaceLayoutState: (workspaceId: string) => void;
  selectWorkspaceById: (workspaceId: string) => Promise<void>;
  startSelectedWorkspaceBackgroundStartup: (workspaceId: string) => Promise<void>;
  getRemoveWorkspaceSurfaces: () => ((workspaceId: string) => Promise<void>) | null;
};

// ─── factory ─────────────────────────────────────────────────────────────────

export function createWorkspaceCrudService(ctx: WorkspaceCrudContext) {
  function removeScopeState(scopeId: string) {
    useTerminalScopeStore.getState().removeScope(scopeId);
    useLayoutStore.getState().removeLayout(scopeId);
  }

  async function addProject(path: string): Promise<void> {
    try {
      const knownProjectIds = new Set(useCatalogStore.getState().projects.map((entry) => entry.id));
      const project = await apiAddProject(path);
      const isNewProject = !knownProjectIds.has(project.id);
      let autoCreatedWorkspaceId: string | null = null;
      if (isNewProject) {
        const created = await apiCreateWorkspace(project.id, { workspaceKind: "linked" });
        autoCreatedWorkspaceId = created.id;
        ctx.terminalStartup.markPendingInitialTerminal(created.id);
      }
      const appState = await loadAppState();
    const { allowedScopeIds } = applyAppState(appState);
    ctx.terminalStartup.cleanupAllowedScopeIds(allowedScopeIds);
    if (autoCreatedWorkspaceId) {
        useNavigationStore.getState().selectWorkspace(autoCreatedWorkspaceId, project.id);
      } else {
        useNavigationStore.getState().selectProject(project.id);
      }
      await saveSelection(
        project.id,
        autoCreatedWorkspaceId ?? useNavigationStore.getState().selectedWorkspaceID,
      );
    } catch (cause) {
      throw new DesktopStateLoadError({ cause });
    }
  }

  async function toggleProject(projectId: string): Promise<void> {
    try {
      await apiToggleProject(projectId);
      const appState = await loadAppState();
      const { allowedScopeIds } = applyAppState(appState);
      ctx.terminalStartup.cleanupAllowedScopeIds(allowedScopeIds);
    } catch (cause) {
      throw new DesktopStateLoadError({ cause });
    }
  }

  async function removeProject(projectId: string): Promise<void> {
    const scopeId = `project:${projectId}`;
    ctx.terminalStartup.clearScopeTerminalStartupTracking(scopeId);
    try {
      removeScopeState(scopeId);
      if (useNavigationStore.getState().layoutTargetScopeId === scopeId) {
        useNavigationStore.getState().setLayoutTargetScopeId(null);
      }
      await apiRemoveProject(projectId);
      const appState = await loadAppState();
      const { allowedScopeIds } = applyAppState(appState);
      ctx.terminalStartup.cleanupAllowedScopeIds(allowedScopeIds);
    } catch (cause) {
      throw new DesktopStateLoadError({ cause });
    }
    await ctx.terminalStartup.refreshActiveScopeTerminalStartup({ rebuildHiddenQueues: true });
  }

  async function createWorkspace(projectId: string, workspaceKind?: WorkspaceKind): Promise<void> {
    const { branchPrefixMode, branchPrefixCustom } = useSettingsStore.getState();
    const branchPrefix =
      branchPrefixMode === "none"
        ? ""
        : branchPrefixMode === "custom"
          ? branchPrefixCustom
          : undefined;
    let created: WorkspaceRecord;
    try {
      created = await apiCreateWorkspace(projectId, {
        ...(workspaceKind != null ? { workspaceKind } : {}),
        ...(workspaceKind !== "linked" && branchPrefix !== undefined ? { branchPrefix } : {}),
      });
    } catch (cause) {
      throw workspaceSelectionError(cause);
    }
    ctx.terminalStartup.markPendingInitialTerminal(created.id);
    const projects = useCatalogStore.getState().projects;
    const updatedProject = projects.find((p) => p.id === projectId);
    if (updatedProject) {
      useCatalogStore.getState().applyAppState(
        projects.map((p) => (p.id === projectId ? { ...p, isExpanded: true } : p)),
        useCatalogStore.getState().workspaces,
      );
    }
    patchWorkspaceRecord(created);
    await ctx.selectWorkspaceById(created.id);
  }

  async function retryWorkspace(workspaceId: string): Promise<void> {
    ctx.resetWorkspaceLayoutState(workspaceId);
    try {
      const updated = await apiRetryWorkspace(workspaceId);
      patchWorkspaceRecord(updated);
    } catch (cause) {
      throw workspaceSelectionError(cause, workspaceId);
    }
  }

  async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
    const workspace = useCatalogStore.getState().workspaces.find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace)
      throw workspaceSelectionError(new Error("Workspace not found"), workspaceId);

    if (workspace.workspaceKind === "worktree") {
      const removeWorkspaceSurfaces = ctx.getRemoveWorkspaceSurfaces();
      if (removeWorkspaceSurfaces) {
        await removeWorkspaceSurfaces(workspaceId).catch(() => {});
      }
      ctx.terminalStartup.clearScopeTerminalStartupTracking(workspaceId);
      ctx.resetWorkspaceLayoutState(workspaceId);
      removeScopeState(workspaceId);
    }

    let renamed: WorkspaceRecord;
    try {
      renamed = await apiRenameWorkspace(workspaceId, name);
    } catch (cause) {
      throw workspaceSelectionError(cause, workspaceId);
    }

    patchWorkspaceRecord(renamed);

    if (
      renamed.id === useNavigationStore.getState().selectedWorkspaceID &&
      renamed.status === "ready"
    ) {
      ctx.startSelectedWorkspaceBackgroundStartup(renamed.id).catch((error) =>
        console.warn("Failed to start workspace background startup:", error),
      );
    }
  }

  async function removeWorkspace(workspaceId: string): Promise<void> {
    const workspace = useCatalogStore.getState().workspaces.find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace)
      throw workspaceSelectionError(new Error("Workspace not found"), workspaceId);

    try {
      await apiRemoveWorkspace(workspaceId);
      const appState = await loadAppState();
      const { allowedScopeIds } = applyAppState(appState);
      ctx.terminalStartup.cleanupAllowedScopeIds(allowedScopeIds);
    } catch (cause) {
      throw workspaceSelectionError(cause, workspaceId);
    }

    const removeWorkspaceSurfaces = ctx.getRemoveWorkspaceSurfaces();
    if (removeWorkspaceSurfaces) {
      await removeWorkspaceSurfaces(workspaceId).catch(() => {});
    }
    ctx.terminalStartup.clearScopeTerminalStartupTracking(workspaceId);
    ctx.resetWorkspaceLayoutState(workspaceId);
    removeScopeState(workspaceId);

    const selectedWorkspaceId = useNavigationStore.getState().selectedWorkspaceID;
    if (selectedWorkspaceId) {
      ctx.startSelectedWorkspaceBackgroundStartup(selectedWorkspaceId).catch((error) =>
        console.warn("Failed to start workspace background startup:", error),
      );
    }
    await ctx.terminalStartup.refreshActiveScopeTerminalStartup({ rebuildHiddenQueues: true });
  }

  async function archiveWorkspace(
    workspaceId: string,
    options?: { deleteWorktree?: boolean },
  ): Promise<void> {
    const workspace = useCatalogStore.getState().workspaces.find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace)
      throw workspaceSelectionError(new Error("Workspace not found"), workspaceId);

    const deleteWorktree = options?.deleteWorktree ?? false;
    let preflight: { canArchive: boolean; message: string | null };
    try {
      preflight = await apiCanArchiveWorkspace(workspaceId, deleteWorktree);
    } catch (cause) {
      throw workspaceSelectionError(cause, workspaceId);
    }
    if (!preflight.canArchive) {
      throw workspaceSelectionError(
        new Error(preflight.message ?? "Workspace is not safe to archive."),
        workspaceId,
      );
    }

    const wasSelected = useNavigationStore.getState().selectedWorkspaceID === workspaceId;
    const nextWorkspace = wasSelected
      ? findNearestWorkspaceInProject(useCatalogStore.getState().workspaces, workspaceId)
      : null;

    const { runTeardownOnArchive } = useSettingsStore.getState();
    try {
      await apiArchiveWorkspace(workspaceId, deleteWorktree, runTeardownOnArchive);
    } catch (cause) {
      try {
        const appState = await loadAppState();
        const { allowedScopeIds } = applyAppState(appState);
        ctx.terminalStartup.cleanupAllowedScopeIds(allowedScopeIds);
      } catch {
        // ignore
      }
      throw workspaceSelectionError(cause, workspaceId);
    }

    const appState = await loadAppState().catch(() => null);
    if (appState) {
      const { allowedScopeIds } = applyAppState(appState);
      ctx.terminalStartup.cleanupAllowedScopeIds(allowedScopeIds);
    }

    const removeWorkspaceSurfaces = ctx.getRemoveWorkspaceSurfaces();
    if (removeWorkspaceSurfaces) {
      await removeWorkspaceSurfaces(workspaceId).catch(() => {});
    }

    if (wasSelected && nextWorkspace) {
      await ctx.selectWorkspaceById(nextWorkspace.id);
    } else if (wasSelected) {
      useNavigationStore.getState().clearSelection();
      useNavigationStore.getState().selectProject(workspace.projectId);
      await saveSelection(workspace.projectId, null).catch(() => {});
    }
  }

  async function restoreWorkspace(workspaceId: string): Promise<void> {
    const workspace = useCatalogStore.getState().workspaces.find((w) => w.id === workspaceId);
    if (workspace) {
      useCatalogStore.getState().patchWorkspace({ ...workspace, status: "ready" });
    }
    await apiRestoreWorkspace(workspaceId);
  }

  return {
    addProject,
    toggleProject,
    removeProject,
    createWorkspace,
    retryWorkspace,
    renameWorkspace,
    removeWorkspace,
    archiveWorkspace,
    restoreWorkspace,
  };
}

export type WorkspaceCrudService = ReturnType<typeof createWorkspaceCrudService>;
