import type { ProjectRecord, WorkspaceRecord, WorkspaceKind, WorkspaceRuntimeState } from "@/lib/shared/types";
import type { AppState } from "@/lib/shared/types";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { createEmptyTerminalPanel } from "@/lib/terminal/bottom-terminal-panel";
import { createLeaf } from "@/lib/layout/layout-tree";
import { invoke } from "@tauri-apps/api/core";
import type { NavigationArea } from "../workspace-store";
import type { ImmerSet, Get } from "./types";

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
        s.runtimes[pk] = {
          workspaceId: pk,
          slots: [],
          sessions: [],
          terminalDisplayBySlotId: {},
          connectionState: "connecting",
          root: placeholder,
          focusedPaneID: placeholder.id,
          terminalPanel: createEmptyTerminalPanel(),
          layoutLoading: false,
        } as WorkspaceRuntimeState as WritableDraft<WorkspaceRuntimeState>;
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
      set((s) => {
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
        if (!runtime) {
          const defaultCwd = workspace.workspaceContextSubpath
            ? `${workspace.worktreePath}/${workspace.workspaceContextSubpath}`
            : workspace.worktreePath;

          void invoke("start_workspace_runtime", {
            workspaceId: workspace.id,
            workspacePath: workspace.worktreePath,
            defaultCwd,
          });

          set((s) => {
            s.runtimes[workspace.id] = {
              workspaceId: workspace.id,
              slots: [],
              sessions: [],
              terminalDisplayBySlotId: {},
              connectionState: "connecting",
              root: null,
              focusedPaneID: null,
              terminalPanel: null,
              layoutLoading: true,
            } as WorkspaceRuntimeState as WritableDraft<WorkspaceRuntimeState>;
          });

          void get().loadPersistedLayout(workspace.id);
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
