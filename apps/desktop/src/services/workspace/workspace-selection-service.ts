import type { WritableDraft } from "immer";
import type { WorkspaceRecord, WorkspaceRuntimeState } from "@/lib/shared/types";
import {
  desktopStateSnapshot,
  publishDesktopNow,
  updateDesktopState,
  getVisibleSidebarWorkspaces,
} from "@/services/workspace/desktop-view-service";
import { WorkspaceSelectionError } from "@/services/service-errors";
import {
  syncProjectScopedRuntime,
  type WorkspaceStartupGet,
  type WorkspaceStartupSet,
} from "@/services/workspace/workspace-startup";
import { projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { acknowledgeSelectedTerminalAgentStatus } from "@/lib/terminal/agent-activity";
import {
  saveSelection,
  markWorkspaceOpened as apiMarkWorkspaceOpened,
  startWorkspaceRuntime as apiStartWorkspaceRuntime,
} from "@/services/workspace/workspace-api";
import { fileTreeInitExpansion } from "@/services/file-tree/file-tree-service";
import { scmInit } from "@/services/scm/scm-service";
import type { createTerminalStartupService } from "@/services/terminal/terminal-startup-service";
import type { NavigationArea } from "@/services/workspace/desktop-view-projections";

// ─── standalone utilities ─────────────────────────────────────────────────────

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

export type WorkspaceSelectionContext = {
  terminalStartup: ReturnType<typeof createTerminalStartupService>;
  updateWorkspaceRuntime: (
    workspaceId: string,
    mutate: (runtime: WritableDraft<WorkspaceRuntimeState>) => boolean | void,
  ) => void;
  startupGet: WorkspaceStartupGet;
  startupSet: WorkspaceStartupSet;
  startWorkspaceStartup: (
    set: WorkspaceStartupSet,
    get: WorkspaceStartupGet,
    workspace: WorkspaceRecord,
  ) => void;
  hydrateProjectRuntimePanel: (runtimeId: string) => Promise<void>;
};

// ─── factory ─────────────────────────────────────────────────────────────────

export function createWorkspaceSelectionService(ctx: WorkspaceSelectionContext) {
  const connectionWaiters = new Map<string, Array<() => void>>();

  let selectionTargetWorkspaceID: string | null = null;
  let selectionSettleToken = 0;

  function applyWorkspaceSelection(
    workspace: WorkspaceRecord,
    navigationArea: NavigationArea = "sidebar",
  ) {
    selectionTargetWorkspaceID = workspace.id;
    desktopStateSnapshot.selectedWorkspaceID = workspace.id;
    desktopStateSnapshot.selectedProjectID = workspace.projectId;
    desktopStateSnapshot.navigationArea = navigationArea;
    desktopStateSnapshot.layoutTargetRuntimeId = null;
    publishDesktopNow();
  }

  function waitForWorkspaceConnection(workspaceId: string): Promise<void> {
    if (desktopStateSnapshot.runtimes[workspaceId]?.connectionState === "connected") {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const waiters = connectionWaiters.get(workspaceId);
        if (waiters) {
          const idx = waiters.indexOf(onConnected);
          if (idx !== -1) waiters.splice(idx, 1);
          if (waiters.length === 0) connectionWaiters.delete(workspaceId);
        }
        reject(
          workspaceSelectionError(
            new Error(`Workspace runtime did not connect for ${workspaceId}`),
            workspaceId,
          ),
        );
      }, 5000);

      const onConnected = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      const existing = connectionWaiters.get(workspaceId) ?? [];
      existing.push(onConnected);
      connectionWaiters.set(workspaceId, existing);
    });
  }

  function startSelectionSettle(workspace: WorkspaceRecord) {
    selectionSettleToken++;
    const token = selectionSettleToken;

    void (async () => {
      try {
        if (desktopStateSnapshot.selectedWorkspaceID !== workspace.id) return;

        if (workspace.status === "ready") {
          syncProjectScopedRuntime(ctx.startupSet, ctx.startupGet, workspace);
          ctx.startWorkspaceStartup(ctx.startupSet, ctx.startupGet, workspace);
          void fileTreeInitExpansion(workspace.id);
          scmInit(workspace.id);
          if (
            token !== selectionSettleToken ||
            desktopStateSnapshot.selectedWorkspaceID !== workspace.id
          )
            return;
          await ctx.hydrateProjectRuntimePanel(projectRuntimeKey(workspace.projectId));
        }

        if (
          token !== selectionSettleToken ||
          desktopStateSnapshot.selectedWorkspaceID !== workspace.id
        )
          return;
        await ctx.terminalStartup.refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: false });
        if (
          token !== selectionSettleToken ||
          desktopStateSnapshot.selectedWorkspaceID !== workspace.id
        )
          return;
        ctx.updateWorkspaceRuntime(workspace.id, (runtime) => {
          acknowledgeSelectedTerminalAgentStatus(runtime);
        });
      } catch (error) {
        console.warn("Failed to settle selected workspace:", error);
      }
    })();
  }

  async function selectWorkspaceById(
    workspaceId: string,
    navigationArea: NavigationArea = "sidebar",
  ): Promise<void> {
    const workspace = desktopStateSnapshot.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace)
      throw workspaceSelectionError(new Error("Workspace not found"), workspaceId);

    applyWorkspaceSelection(workspace, navigationArea);
    void saveSelection(workspace.projectId, workspace.id);
    void apiMarkWorkspaceOpened(workspace.id);
    startSelectionSettle(workspace);
  }

  async function selectWorkspaceRelative(
    offset: number,
    navigationArea: NavigationArea = "sidebar",
  ): Promise<void> {
    const visibleWorkspaces = getVisibleSidebarWorkspaces();
    if (visibleWorkspaces.length === 0) return;
    const currentIndex = visibleWorkspaces.findIndex(
      (workspace) =>
        workspace.id ===
        (selectionTargetWorkspaceID ?? desktopStateSnapshot.selectedWorkspaceID),
    );
    const nextIndex = Math.max(
      0,
      Math.min(visibleWorkspaces.length - 1, (currentIndex >= 0 ? currentIndex : 0) + offset),
    );
    const workspace = visibleWorkspaces[nextIndex];
    if (!workspace) return;
    await selectWorkspaceById(workspace.id);
    if (navigationArea !== "sidebar") {
      updateDesktopState((state) => {
        state.navigationArea = navigationArea;
      });
    }
  }

  async function maybeStartSelectedWorkspace(): Promise<void> {
    const selectedWorkspaceId = desktopStateSnapshot.selectedWorkspaceID;
    if (!selectedWorkspaceId) return;
    const workspace = desktopStateSnapshot.workspaces.find(
      (entry) => entry.id === selectedWorkspaceId,
    );
    if (!workspace || workspace.status !== "ready") return;
    syncProjectScopedRuntime(ctx.startupSet, ctx.startupGet, workspace);
    ctx.startWorkspaceStartup(ctx.startupSet, ctx.startupGet, workspace);
    void fileTreeInitExpansion(workspace.id);
    scmInit(workspace.id);
    await ctx.hydrateProjectRuntimePanel(projectRuntimeKey(workspace.projectId));
    await ctx.terminalStartup.refreshActiveRuntimeTerminalStartup({ rebuildHiddenQueues: false });
  }

  async function ensureWorkspaceRuntimeConnected(workspaceId: string): Promise<void> {
    if (desktopStateSnapshot.runtimes[workspaceId]?.connectionState === "connected") return;

    const workspace = desktopStateSnapshot.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace || workspace.status !== "ready") {
      throw workspaceSelectionError(
        new Error(`Workspace ${workspaceId} is not ready`),
        workspaceId,
      );
    }

    const defaultCwd = workspace.workspaceContextSubpath
      ? `${workspace.worktreePath}/${workspace.workspaceContextSubpath}`
      : workspace.worktreePath;

    try {
      await apiStartWorkspaceRuntime(workspace.id, workspace.worktreePath, defaultCwd);
    } catch (cause) {
      throw workspaceSelectionError(cause, workspaceId);
    }

    await waitForWorkspaceConnection(workspaceId);
  }

  return {
    connectionWaiters,
    getSelectionTarget: () => selectionTargetWorkspaceID,
    setSelectionTarget: (id: string | null) => {
      selectionTargetWorkspaceID = id;
    },
    applyWorkspaceSelection,
    waitForWorkspaceConnection,
    selectWorkspaceById,
    selectWorkspaceRelative,
    startSelectionSettle,
    maybeStartSelectedWorkspace,
    ensureWorkspaceRuntimeConnected,
  };
}

export type WorkspaceSelectionService = ReturnType<typeof createWorkspaceSelectionService>;
