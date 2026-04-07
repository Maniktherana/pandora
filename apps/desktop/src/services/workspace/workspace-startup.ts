import { invoke } from "@tauri-apps/api/core";
import { Effect, Fiber } from "effect";
import type { WritableDraft } from "immer";
import type {
  LayoutNode,
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { LayoutLoadError, RuntimeStartError } from "@/lib/runtime/errors";
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
    workspace: WorkspaceRecord
  ) => void;
  interruptWorkspaceStartup: (
    set: WorkspaceStartupSet,
    workspaceId: string,
    disconnected?: boolean
  ) => void;
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
  }
): WorkspaceRuntimeState {
  return {
    workspaceId,
    slots: [],
    sessions: [],
    terminalDisplayBySlotId: {},
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

function loadWorkspaceLayoutEffect(
  get: WorkspaceStartupGet,
  set: WorkspaceStartupSet,
  workspaceId: string
) {
  return Effect.tryPromise({
    try: () => invoke<unknown>("load_workspace_layout", { workspaceId }),
    catch: (cause) =>
      new LayoutLoadError({
        workspaceId,
        cause,
      }),
  }).pipe(
    Effect.map((raw) => (raw != null ? migratePersistedLayout(raw) : null)),
    Effect.tap((layout) =>
      Effect.sync(() => {
        set((s) => {
          const runtime = s.runtimes[workspaceId];
          if (!runtime) return;

          runtime.layoutLoading = false;
          runtime.layoutLoaded = true;
          runtime.root = (layout?.root ?? null) as WritableDraft<LayoutNode> | null;
          runtime.focusedPaneID = layout?.focusedPaneID ?? null;
        });

        // Reconcile any live slots into the loaded layout. Without this, slots that
        // arrive while layoutLoading is true can be dropped from the visible pane tree.
        get().ensureRuntimeLayout(workspaceId);
      })
    ),
    Effect.asVoid
  );
}

export function resetWorkspaceStartupState(
  set: WorkspaceStartupSet,
  workspaceId: string,
  disconnected = false
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

export function startWorkspaceRuntimeEffect(
  get: WorkspaceStartupGet,
  set: WorkspaceStartupSet,
  workspace: WorkspaceRecord
) {
  const defaultCwd = workspace.workspaceContextSubpath
    ? `${workspace.worktreePath}/${workspace.workspaceContextSubpath}`
    : workspace.worktreePath;

  return Effect.gen(function* () {
    yield* Effect.all(
      [
        Effect.tryPromise({
          try: () =>
            invoke("start_workspace_runtime", {
              workspaceId: workspace.id,
              workspacePath: workspace.worktreePath,
              defaultCwd,
            }),
          catch: (cause) =>
            new RuntimeStartError({
              workspaceId: workspace.id,
              cause,
            }),
        }),
        loadWorkspaceLayoutEffect(get, set, workspace.id),
      ],
      { concurrency: "unbounded" }
    );
  }).pipe(
    Effect.timeout("10 seconds"),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error("Workspace startup failed:", error);
        resetWorkspaceStartupState(set, workspace.id, true);
      })
    )
  );
}

export function syncProjectScopedRuntime(
  set: WorkspaceStartupSet,
  get: WorkspaceStartupGet,
  workspace: WorkspaceRecord
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
  workspace: WorkspaceRecord
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
  let current: { workspaceId: string; fiber: Fiber.RuntimeFiber<void, never> } | null = null;

  function interruptWorkspaceStartup(
    set: WorkspaceStartupSet,
    workspaceId: string,
    disconnected = false
  ) {
    if (current?.workspaceId !== workspaceId) return;

    resetWorkspaceStartupState(set, workspaceId, disconnected);
    void Effect.runFork(Fiber.interrupt(current.fiber));
    current = null;
  }

  function startWorkspaceStartup(
    set: WorkspaceStartupSet,
    get: WorkspaceStartupGet,
    workspace: WorkspaceRecord
  ) {
    if (current && current.workspaceId !== workspace.id) {
      interruptWorkspaceStartup(set, current.workspaceId);
    }

    if (workspace.status !== "ready") return;

    const runtime = get().runtimes[workspace.id];
    if (runtime?.layoutLoaded) return;
    if (runtime?.layoutLoading && current?.workspaceId === workspace.id) return;

    ensureWorkspaceStartupRuntime(set, get, workspace);

    const fiber = Effect.runFork(startWorkspaceRuntimeEffect(get, set, workspace));
    fiber.addObserver(() => {
      if (current?.fiber === fiber) {
        current = null;
      }
    });
    current = { workspaceId: workspace.id, fiber };
  }

  return { startWorkspaceStartup, interruptWorkspaceStartup };
}
