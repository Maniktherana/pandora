import { invoke } from "@tauri-apps/api/core";
import type { WritableDraft } from "immer";
import type {
  LayoutNode,
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { LayoutLoadError } from "@/lib/runtime/errors";
import { projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { createEmptyTerminalPanel } from "@/lib/terminal/bottom-terminal-panel";
import { createLeaf } from "@/components/layout/workspace/layout-tree";
import { migratePersistedLayout } from "@/components/layout/workspace/layout-migrate";

export interface WorkspaceStartupState {
  projects: ProjectRecord[];
  runtimes: Record<string, WorkspaceRuntimeState>;
  ensureRuntimeLayout: (workspaceId: string) => void;
}

export type WorkspaceStartupSet = {
  (fn: (state: WritableDraft<WorkspaceStartupState>) => void): void;
  (partial: Partial<WorkspaceStartupState>): void;
};

export type WorkspaceStartupGet = () => WorkspaceStartupState;

export interface WorkspaceStartupController {
  startWorkspaceStartup: (
    set: WorkspaceStartupSet,
    get: WorkspaceStartupGet,
    workspace: WorkspaceRecord,
  ) => void;
  interruptWorkspaceStartup: (
    set: WorkspaceStartupSet,
    workspaceId: string,
    disconnected?: boolean,
  ) => void;
}

export function shouldStartWorkspaceStartup(runtime: WorkspaceRuntimeState | undefined) {
  if (!runtime) return true;
  if (runtime.layoutLoading) return true;
  if (!runtime.layoutLoaded) return true;
  return runtime.connectionState !== "connected";
}

export function createWorkspaceRuntimeState(
  workspaceId: string,
  {
    root = null,
    focusedPaneID = null,
    terminalPanel = null,
    layoutLoading,
    layoutLoaded,
  }: {
    root?: LayoutNode | null;
    focusedPaneID?: string | null;
    terminalPanel?: WorkspaceRuntimeState["terminalPanel"];
    layoutLoading: boolean;
    layoutLoaded: boolean;
  },
): WorkspaceRuntimeState {
  return {
    workspaceId,
    slots: [],
    sessions: [],
    detectedPorts: [],
    terminalDisplayBySlotId: {},
    terminalAgentStatusBySlotId: {},
    connectionState: "connecting",
    root,
    focusedPaneID,
    terminalPanel,
    layoutLoading,
    layoutLoaded,
  };
}

export function createPlaceholderWorkspaceRoot() {
  const leaf = createLeaf([]);
  return { root: leaf, focusedPaneID: leaf.id };
}

async function loadWorkspaceLayout(
  get: WorkspaceStartupGet,
  set: WorkspaceStartupSet,
  workspaceId: string,
): Promise<void> {
  let raw: unknown;
  try {
    raw = await invoke<unknown>("load_workspace_layout", { workspaceId });
  } catch (cause) {
    throw new LayoutLoadError({ workspaceId, cause });
  }
  const layout = raw != null ? migratePersistedLayout(raw) : null;
  set((s) => {
    const runtime = s.runtimes[workspaceId];
    if (!runtime) return;
    runtime.layoutLoading = false;
    runtime.layoutLoaded = true;
    runtime.root = (layout?.root ?? null) as WritableDraft<LayoutNode> | null;
    runtime.focusedPaneID = layout?.focusedPaneID ?? null;
  });
  // Reconcile any live slots into the loaded layout.
  get().ensureRuntimeLayout(workspaceId);
}

export function resetWorkspaceStartupState(
  set: WorkspaceStartupSet,
  workspaceId: string,
  disconnected = false,
) {
  set((s) => {
    const runtime = s.runtimes[workspaceId];
    if (!runtime) return;
    runtime.layoutLoading = false;
    if (!runtime.root) {
      runtime.layoutLoaded = false;
    }
    if (disconnected) {
      runtime.connectionState = "disconnected";
    }
  });
}

async function runWorkspaceStartup(
  get: WorkspaceStartupGet,
  set: WorkspaceStartupSet,
  workspace: WorkspaceRecord,
): Promise<void> {
  const defaultCwd = workspace.workspaceContextSubpath
    ? `${workspace.worktreePath}/${workspace.workspaceContextSubpath}`
    : workspace.worktreePath;

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("workspace startup timeout")), 10_000),
  );

  await Promise.race([
    Promise.all([
      invoke("start_workspace_runtime", {
        workspaceId: workspace.id,
        workspacePath: workspace.worktreePath,
        defaultCwd,
      }),
      loadWorkspaceLayout(get, set, workspace.id),
    ]),
    timeout,
  ]);
}

export function syncProjectScopedRuntime(
  set: WorkspaceStartupSet,
  get: WorkspaceStartupGet,
  workspace: WorkspaceRecord,
) {
  const project = get().projects.find((p) => p.id === workspace.projectId);
  if (!project || workspace.status !== "ready") return;

  const pk = projectRuntimeKey(workspace.projectId);

  if (!get().runtimes[pk]) {
    void invoke("start_project_runtime", {
      projectId: project.id,
      gitRootPath: project.gitRootPath,
      defaultCwd: project.gitRootPath,
    });
    const placeholder = createLeaf([]);
    set((s) => {
      s.runtimes[pk] = createWorkspaceRuntimeState(pk, {
        root: placeholder,
        focusedPaneID: placeholder.id,
        terminalPanel: createEmptyTerminalPanel(),
        layoutLoading: false,
        layoutLoaded: true,
      }) as WritableDraft<WorkspaceRuntimeState>;
    });
  }
}

export function ensureWorkspaceStartupRuntime(
  set: WorkspaceStartupSet,
  get: WorkspaceStartupGet,
  workspace: WorkspaceRecord,
) {
  const runtime = get().runtimes[workspace.id];
  if (runtime && (runtime.layoutLoaded || runtime.layoutLoading)) return;

  const placeholder = createPlaceholderWorkspaceRoot();
  set((s) => {
    const existing = s.runtimes[workspace.id];
    if (existing) {
      existing.layoutLoading = true;
      existing.layoutLoaded = false;
      existing.connectionState = "connecting";
      existing.root = existing.root ?? (placeholder.root as WritableDraft<LayoutNode>);
      existing.focusedPaneID = existing.focusedPaneID ?? placeholder.focusedPaneID;
      existing.terminalPanel = existing.terminalPanel ?? null;
    } else {
      s.runtimes[workspace.id] = createWorkspaceRuntimeState(workspace.id, {
        root: placeholder.root,
        focusedPaneID: placeholder.focusedPaneID,
        layoutLoading: true,
        layoutLoaded: false,
      }) as WritableDraft<WorkspaceRuntimeState>;
    }
  });
}

export function createWorkspaceStartupController(): WorkspaceStartupController {
  let currentWorkspaceId: string | null = null;
  let generation = 0;

  function interruptWorkspaceStartup(
    set: WorkspaceStartupSet,
    workspaceId: string,
    disconnected = false,
  ) {
    if (currentWorkspaceId !== workspaceId) return;
    resetWorkspaceStartupState(set, workspaceId, disconnected);
    generation++;
    currentWorkspaceId = null;
  }

  function startWorkspaceStartup(
    set: WorkspaceStartupSet,
    get: WorkspaceStartupGet,
    workspace: WorkspaceRecord,
  ) {
    if (currentWorkspaceId && currentWorkspaceId !== workspace.id) {
      interruptWorkspaceStartup(set, currentWorkspaceId);
    }

    if (workspace.status !== "ready") return;

    const runtime = get().runtimes[workspace.id];
    if (!shouldStartWorkspaceStartup(runtime)) return;
    if (runtime?.layoutLoading && currentWorkspaceId === workspace.id) return;

    ensureWorkspaceStartupRuntime(set, get, workspace);

    currentWorkspaceId = workspace.id;
    const myGeneration = ++generation;

    void runWorkspaceStartup(get, set, workspace)
      .catch((error) => {
        if (generation === myGeneration) {
          console.error("Workspace startup failed:", error);
          resetWorkspaceStartupState(set, workspace.id, true);
        }
      })
      .finally(() => {
        if (generation === myGeneration) {
          currentWorkspaceId = null;
        }
      });
  }

  return { startWorkspaceStartup, interruptWorkspaceStartup };
}
