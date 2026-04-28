import type { WorkspaceKind, WorkspaceRecord } from "@/lib/shared/types";
import {
  desktopStateSnapshot,
  applyAppState,
  patchWorkspaceRecord,
  replaceWorkspaceRecord,
  updateDesktopState,
  scheduleDesktopPublish,
  scheduleRuntimePublish,
  publishDesktopNow,
} from "@/services/workspace/desktop-view-service";
import {
  findNearestWorkspaceInProject,
  workspaceSelectionError,
} from "@/services/workspace/workspace-selection-service";
import { DesktopStateLoadError } from "@/services/service-errors";
import {
  loadAppState,
  saveSelection,
  addProject as apiAddProject,
  toggleProject as apiToggleProject,
  removeProject as apiRemoveProject,
  stopProjectRuntime,
  createWorkspace as apiCreateWorkspace,
  archiveWorkspace as apiArchiveWorkspace,
  canArchiveWorkspace as apiCanArchiveWorkspace,
  restoreWorkspace as apiRestoreWorkspace,
  renameWorkspace as apiRenameWorkspace,
  removeWorkspace as apiRemoveWorkspace,
  retryWorkspace as apiRetryWorkspace,
} from "@/services/workspace/workspace-api";
import { useSettingsStore } from "@/services/settings/settings-store";
import type { WorkspaceStartupSet } from "@/services/workspace/workspace-startup";
import type { createTerminalStartupService } from "@/services/terminal/terminal-startup-service";

// ─── context ──────────────────────────────────────────────────────────────────

export type WorkspaceCrudContext = {
  terminalStartup: ReturnType<typeof createTerminalStartupService>;
  interruptWorkspaceStartup: (set: WorkspaceStartupSet, workspaceId: string, reset?: boolean) => void;
  startupSet: WorkspaceStartupSet;
  selectWorkspaceById: (workspaceId: string) => Promise<void>;
  startSelectionSettle: (workspace: WorkspaceRecord) => void;
  maybeStartSelectedWorkspace: () => Promise<void>;
  getRemoveWorkspaceSurfaces: () => ((workspaceId: string) => Promise<void>) | null;
};

// ─── factory ─────────────────────────────────────────────────────────────────

export function createWorkspaceCrudService(ctx: WorkspaceCrudContext) {
  async function addProject(path: string): Promise<void> {
    try {
      const knownProjectIds = new Set(desktopStateSnapshot.projects.map((entry) => entry.id));
      const project = await apiAddProject(path);
      const isNewProject = !knownProjectIds.has(project.id);
      let autoCreatedWorkspaceId: string | null = null;
      if (isNewProject) {
        const created = await apiCreateWorkspace(project.id, { workspaceKind: "linked" });
        autoCreatedWorkspaceId = created.id;
        ctx.terminalStartup.markPendingInitialTerminal(created.id);
      }
      const appState = await loadAppState();
      const { allowedRuntimeIds } = applyAppState(appState);
      ctx.terminalStartup.cleanupAllowedRuntimeIds(allowedRuntimeIds);
      desktopStateSnapshot.selectedProjectID = project.id;
      if (autoCreatedWorkspaceId) {
        desktopStateSnapshot.selectedWorkspaceID = autoCreatedWorkspaceId;
      }
      publishDesktopNow();
      if (autoCreatedWorkspaceId) {
        const ws = desktopStateSnapshot.workspaces.find((w) => w.id === autoCreatedWorkspaceId);
        if (ws?.status === "ready") ctx.startSelectionSettle(ws);
      }
      await saveSelection(
        project.id,
        autoCreatedWorkspaceId ?? desktopStateSnapshot.selectedWorkspaceID,
      );
    } catch (cause) {
      throw new DesktopStateLoadError({ cause });
    }
  }

  async function toggleProject(projectId: string): Promise<void> {
    try {
      await apiToggleProject(projectId);
      const appState = await loadAppState();
      const { allowedRuntimeIds } = applyAppState(appState);
      ctx.terminalStartup.cleanupAllowedRuntimeIds(allowedRuntimeIds);
    } catch (cause) {
      throw new DesktopStateLoadError({ cause });
    }
  }

  async function removeProject(projectId: string): Promise<void> {
    const runtimeId = `project:${projectId}`;
    ctx.terminalStartup.clearRuntimeTerminalStartupTracking(runtimeId);
    try {
      await stopProjectRuntime(projectId).catch(() => {});
      delete desktopStateSnapshot.runtimes[runtimeId];
      if (desktopStateSnapshot.layoutTargetRuntimeId === runtimeId) {
        desktopStateSnapshot.layoutTargetRuntimeId = null;
      }
      scheduleDesktopPublish();
      scheduleRuntimePublish();
      await apiRemoveProject(projectId);
      const appState = await loadAppState();
      const { allowedRuntimeIds } = applyAppState(appState);
      ctx.terminalStartup.cleanupAllowedRuntimeIds(allowedRuntimeIds);
    } catch (cause) {
      throw new DesktopStateLoadError({ cause });
    }
    await ctx.terminalStartup.refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: true });
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
    desktopStateSnapshot.projects = desktopStateSnapshot.projects.map((entry) =>
      entry.id === projectId ? { ...entry, isExpanded: true } : entry,
    );
    patchWorkspaceRecord(created);
    await ctx.selectWorkspaceById(created.id);
  }

  async function retryWorkspace(workspaceId: string): Promise<void> {
    ctx.interruptWorkspaceStartup(ctx.startupSet, workspaceId, true);
    try {
      const updated = await apiRetryWorkspace(workspaceId);
      patchWorkspaceRecord(updated);
    } catch (cause) {
      throw workspaceSelectionError(cause, workspaceId);
    }
  }

  async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
    const workspace = desktopStateSnapshot.workspaces.find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace)
      throw workspaceSelectionError(new Error("Workspace not found"), workspaceId);

    if (workspace.workspaceKind === "worktree") {
      const removeWorkspaceSurfaces = ctx.getRemoveWorkspaceSurfaces();
      if (removeWorkspaceSurfaces) {
        await removeWorkspaceSurfaces(workspaceId).catch(() => {});
      }
      ctx.terminalStartup.clearRuntimeTerminalStartupTracking(workspaceId);
      ctx.interruptWorkspaceStartup(ctx.startupSet, workspaceId);
      delete desktopStateSnapshot.runtimes[workspaceId];
      scheduleRuntimePublish();
    }

    let renamed: WorkspaceRecord;
    try {
      renamed = await apiRenameWorkspace(workspaceId, name);
    } catch (cause) {
      throw workspaceSelectionError(cause, workspaceId);
    }

    patchWorkspaceRecord(renamed);

    if (
      renamed.id === desktopStateSnapshot.selectedWorkspaceID &&
      renamed.status === "ready"
    ) {
      ctx.startSelectionSettle(renamed);
    }
  }

  async function removeWorkspace(workspaceId: string): Promise<void> {
    const workspace = desktopStateSnapshot.workspaces.find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace)
      throw workspaceSelectionError(new Error("Workspace not found"), workspaceId);

    try {
      await apiRemoveWorkspace(workspaceId);
      const appState = await loadAppState();
      const { allowedRuntimeIds } = applyAppState(appState);
      ctx.terminalStartup.cleanupAllowedRuntimeIds(allowedRuntimeIds);
    } catch (cause) {
      throw workspaceSelectionError(cause, workspaceId);
    }

    const removeWorkspaceSurfaces = ctx.getRemoveWorkspaceSurfaces();
    if (removeWorkspaceSurfaces) {
      await removeWorkspaceSurfaces(workspaceId).catch(() => {});
    }
    ctx.terminalStartup.clearRuntimeTerminalStartupTracking(workspaceId);
    ctx.interruptWorkspaceStartup(ctx.startupSet, workspaceId);
    delete desktopStateSnapshot.runtimes[workspaceId];

    await ctx.maybeStartSelectedWorkspace();
    await ctx.terminalStartup.refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: true });
  }

  async function archiveWorkspace(
    workspaceId: string,
    options?: { deleteWorktree?: boolean },
  ): Promise<void> {
    const workspace = desktopStateSnapshot.workspaces.find(
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

    const wasSelected = desktopStateSnapshot.selectedWorkspaceID === workspaceId;
    const nextWorkspace = wasSelected
      ? findNearestWorkspaceInProject(desktopStateSnapshot.workspaces, workspaceId)
      : null;

    const { runTeardownOnArchive } = useSettingsStore.getState();
    try {
      await apiArchiveWorkspace(workspaceId, deleteWorktree, runTeardownOnArchive);
    } catch (cause) {
      try {
        const appState = await loadAppState();
        const { allowedRuntimeIds } = applyAppState(appState);
        ctx.terminalStartup.cleanupAllowedRuntimeIds(allowedRuntimeIds);
      } catch {
        // ignore
      }
      throw workspaceSelectionError(cause, workspaceId);
    }

    const appState = await loadAppState().catch(() => null);
    if (appState) {
      const { allowedRuntimeIds } = applyAppState(appState);
      ctx.terminalStartup.cleanupAllowedRuntimeIds(allowedRuntimeIds);
    }

    const removeWorkspaceSurfaces = ctx.getRemoveWorkspaceSurfaces();
    if (removeWorkspaceSurfaces) {
      await removeWorkspaceSurfaces(workspaceId).catch(() => {});
    }

    if (wasSelected && nextWorkspace) {
      await ctx.selectWorkspaceById(nextWorkspace.id);
    } else if (wasSelected) {
      updateDesktopState(
        (state) => {
          state.selectedWorkspaceID = null;
          state.selectedProjectID = workspace.projectId;
          state.layoutTargetRuntimeId = null;
        },
        { sync: true },
      );
      await saveSelection(workspace.projectId, null).catch(() => {});
    }
  }

  async function restoreWorkspace(workspaceId: string): Promise<void> {
    updateDesktopState(
      (state) => {
        state.workspaces = replaceWorkspaceRecord(state.workspaces, workspaceId, (workspace) => {
          workspace.status = "ready";
        });
      },
      { sync: true },
    );
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
