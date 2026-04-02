import type { WritableDraft } from "immer";
import type {
  LayoutNode,
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceKind,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import type { AppState } from "@/lib/shared/types";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { createEmptyTerminalPanel } from "@/lib/terminal/bottom-terminal-panel";
import { createLeaf } from "@/lib/layout/layout-tree";
import { migratePersistedLayout } from "@/lib/layout/layout-migrate";
import { sanitizeWorkspaceTerminalLayout } from "./runtime-actions";
import { invoke } from "@tauri-apps/api/core";
import type { NavigationArea } from "../workspace-store";
import type { ImmerSet, Get } from "./types";

let workspaceSwitchGeneration = 0;

function nextWorkspaceSwitchGeneration() {
  workspaceSwitchGeneration += 1;
  return workspaceSwitchGeneration;
}

function isCurrentWorkspaceSwitchGeneration(generation: number) {
  return workspaceSwitchGeneration === generation;
}

function createWorkspaceRuntimeState(
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

async function loadWorkspaceLayout(
  get: Get,
  set: ImmerSet,
  workspaceId: string,
  generation: number
) {
  try {
    const raw = await invoke<unknown>("load_workspace_layout", { workspaceId });
    if (!isCurrentWorkspaceSwitchGeneration(generation)) return;

    const layout = raw != null ? migratePersistedLayout(raw) : null;

    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return;

      const normalizedLayout =
        layout && runtime.slots.length > 0
          ? sanitizeWorkspaceTerminalLayout(
              layout.root,
              layout.focusedPaneID,
              new Set(runtime.slots.map((slot) => slot.id))
            )
          : layout;

      runtime.layoutLoading = false;
      runtime.layoutLoaded = true;
      if (normalizedLayout) {
        runtime.root = normalizedLayout.root as WritableDraft<LayoutNode> | null;
        runtime.focusedPaneID = normalizedLayout.focusedPaneID;
      }
    });

    if (!layout) {
      get().ensureRuntimeLayout(workspaceId);
    }
  } catch {
    if (!isCurrentWorkspaceSwitchGeneration(generation)) return;

    set((s) => {
      const runtime = s.runtimes[workspaceId];
      if (!runtime) return;
      runtime.layoutLoading = false;
      runtime.layoutLoaded = true;
    });
    get().ensureRuntimeLayout(workspaceId);
  }
}

export function createWorkspaceActions(set: ImmerSet, get: Get) {
  const syncProjectScopedRuntime = (workspace: WorkspaceRecord) => {
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
  };

  return {
    loadAppState: async () => {
      try {
        const state = await invoke<AppState>("load_app_state");
        set((s) => {
          s.projects = state.projects as WritableDraft<ProjectRecord>[];
          s.workspaces = state.workspaces as WritableDraft<WorkspaceRecord>[];
          s.selectedProjectID = state.selectedProjectId;
          s.selectedWorkspaceID = state.selectedWorkspaceId;
        });
        const ws = get().workspaces.find((w) => w.id === get().selectedWorkspaceID);
        if (ws?.status === "ready") syncProjectScopedRuntime(ws);
      } catch (e) {
        console.error("Failed to load app state:", e);
      }
    },

    reloadFromBackend: async () => {
      await get().loadAppState();
    },

    // ─── Project actions ───
    addProject: async (path: string) => {
      try {
        const project = await invoke<ProjectRecord>("add_project", { selectedPath: path });
        await get().reloadFromBackend();
        set((s) => {
          s.selectedProjectID = project.id;
        });
        void invoke("save_selection", {
          projectId: project.id,
          workspaceId: get().selectedWorkspaceID,
        });
      } catch (e) {
        console.error("Failed to add project:", e);
      }
    },

    toggleProject: async (projectId: string) => {
      await invoke("toggle_project", { projectId });
      await get().reloadFromBackend();
    },

    removeProject: async (projectId: string) => {
      const pk = projectRuntimeKey(projectId);
      void invoke("stop_project_runtime", { projectId }).catch(() => {});
      set((s) => {
        delete s.runtimes[pk];
        if (s.layoutTargetRuntimeId === pk) {
          s.layoutTargetRuntimeId = null;
        }
      });
      try {
        await invoke("remove_project", { projectId });
        await get().reloadFromBackend();
      } catch (e) {
        console.error("Failed to remove project:", e);
      }
    },

    selectProject: (projectId: string) => {
      set((s) => {
        s.selectedProjectID = projectId;
      });
      void invoke("save_selection", {
        projectId,
        workspaceId: get().selectedWorkspaceID,
      });
    },

    // ─── Workspace actions ───
    createWorkspace: async (projectId: string, workspaceKind?: WorkspaceKind) => {
      try {
        await invoke("create_workspace", {
          projectId,
          ...(workspaceKind != null ? { workspaceKind } : {}),
        });
        await get().reloadFromBackend();
      } catch (e) {
        console.error("Failed to create workspace:", e);
      }
    },

    retryWorkspace: async (workspaceId: string) => {
      try {
        await invoke("retry_workspace", { workspaceId });
        await get().reloadFromBackend();
      } catch (e) {
        console.error("Failed to retry workspace:", e);
      }
    },

    removeWorkspace: async (workspaceId: string) => {
      try {
        await invoke("remove_workspace", { workspaceId });
        set((s) => {
          delete s.runtimes[workspaceId];
          if (s.selectedWorkspaceID === workspaceId) {
            s.selectedWorkspaceID =
            s.workspaces.find((w) => w.id !== workspaceId)?.id ?? null;
          }
        });
        await get().reloadFromBackend();
      } catch (e) {
        console.error("Failed to remove workspace:", e);
      }
    },

    selectWorkspace: (workspace: WorkspaceRecord) => {
      const previousWorkspaceId = get().selectedWorkspaceID;
      const generation = nextWorkspaceSwitchGeneration();

      set((s) => {
        if (previousWorkspaceId && previousWorkspaceId !== workspace.id) {
          const previousRuntime = s.runtimes[previousWorkspaceId];
          if (previousRuntime && previousRuntime.layoutLoading && !previousRuntime.layoutLoaded) {
            previousRuntime.layoutLoading = false;
          }
        }
        s.selectedWorkspaceID = workspace.id;
        s.selectedProjectID = workspace.projectId;
        s.navigationArea = "sidebar" as NavigationArea;
        s.layoutTargetRuntimeId = null;
      });
      void invoke("save_selection", {
        projectId: workspace.projectId,
        workspaceId: workspace.id,
      });

      if (workspace.status === "ready") {
        syncProjectScopedRuntime(workspace);

        const runtime = get().runtimes[workspace.id];
        if (!runtime || (!runtime.layoutLoaded && !runtime.layoutLoading)) {
          const defaultCwd = workspace.workspaceContextSubpath
            ? `${workspace.worktreePath}/${workspace.workspaceContextSubpath}`
            : workspace.worktreePath;

          set((s) => {
            const existing = s.runtimes[workspace.id];
            if (existing) {
              existing.layoutLoading = true;
              existing.layoutLoaded = false;
              existing.connectionState = "connecting";
              existing.root = existing.root ?? null;
              existing.focusedPaneID = existing.focusedPaneID ?? null;
              existing.terminalPanel = existing.terminalPanel ?? null;
            } else {
              s.runtimes[workspace.id] = createWorkspaceRuntimeState(workspace.id, {
                layoutLoading: true,
                layoutLoaded: false,
              }) as WritableDraft<WorkspaceRuntimeState>;
            }
          });

          void (async () => {
            try {
              await invoke("start_workspace_runtime", {
                workspaceId: workspace.id,
                workspacePath: workspace.worktreePath,
                defaultCwd,
              });
              if (!isCurrentWorkspaceSwitchGeneration(generation)) return;
              await loadWorkspaceLayout(get, set, workspace.id, generation);
            } catch (error) {
              if (!isCurrentWorkspaceSwitchGeneration(generation)) return;
              console.error("Failed to start workspace runtime:", error);
              set((s) => {
                const runtime = s.runtimes[workspace.id];
                if (!runtime) return;
                runtime.layoutLoading = false;
                runtime.layoutLoaded = false;
              });
            }
          })();
        } else if (!runtime.layoutLoaded && runtime.layoutLoading) {
          // Reuse the in-flight load instead of kicking off a duplicate IPC chain.
        }
      }

      void invoke("mark_workspace_opened", { workspaceId: workspace.id });
    },

    markWorkspaceOpened: async (workspaceId: string) => {
      await invoke("mark_workspace_opened", { workspaceId });
    },

    // ─── PR ───
    setPrAwaiting: (workspaceId: string, awaiting: boolean) => {
      set((s) => {
        const next = new Set(s.prAwaitingWorkspaceIds);
        if (awaiting) {
          next.add(workspaceId);
        } else {
          next.delete(workspaceId);
        }
        s.prAwaitingWorkspaceIds = next;
      });

      if (awaiting) {
        setTimeout(() => {
          const s = get();
          if (s.prAwaitingWorkspaceIds.has(workspaceId)) {
            s.setPrAwaiting(workspaceId, false);
          }
        }, 90_000);
      }
    },

    updateWorkspacePr: (workspaceId: string, prUrl: string, prNumber: number, prState: string) => {
      set((s) => {
        const ws = s.workspaces.find((w) => w.id === workspaceId);
        if (ws) {
          ws.prUrl = prUrl;
          ws.prNumber = prNumber;
          ws.prState = prState as any;
        }
      });
    },

    updateWorkspacePrState: (workspaceId: string, prState: string) => {
      set((s) => {
        const ws = s.workspaces.find((w) => w.id === workspaceId);
        if (ws) {
          ws.prState = prState as any;
        }
      });
    },

    archiveWorkspaceFromStore: (workspaceId: string) => {
      set((s) => {
        const ws = s.workspaces.find((w) => w.id === workspaceId);
        if (ws) {
          ws.status = "archived" as any;
        }
      });

      const { selectedWorkspaceID, workspaces, selectedProjectID } = get();
      if (selectedWorkspaceID === workspaceId) {
        const next = workspaces.find(
          (w) => w.projectId === selectedProjectID && w.id !== workspaceId && w.status !== "archived"
        );
        if (next) {
          get().selectWorkspace(next);
        }
      }
    },

    // ─── Navigation ───
    navigateSidebar: (offset: number) => {
      const { workspaces, selectedWorkspaceID } = get();
      if (workspaces.length === 0) return;
      const currentIdx = workspaces.findIndex((w) => w.id === selectedWorkspaceID);
      const nextIdx = Math.max(0, Math.min(workspaces.length - 1, currentIdx + offset));
      const ws = workspaces[nextIdx];
      if (ws) get().selectWorkspace(ws);
    },
  };
}
