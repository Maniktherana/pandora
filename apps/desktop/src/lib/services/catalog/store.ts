import { create } from "zustand";
import type { ProjectRecord, WorkspaceRecord } from "@/lib/shared/shared.types";

function byCreatedAtDesc(a: { createdAt: string }, b: { createdAt: string }) {
  return b.createdAt.localeCompare(a.createdAt);
}

interface CatalogStoreState {
  projects: ProjectRecord[];
  workspaces: WorkspaceRecord[];

  setProjects: (projects: ProjectRecord[]) => void;
  setWorkspaces: (workspaces: WorkspaceRecord[]) => void;
  patchWorkspace: (workspace: WorkspaceRecord) => void;
  removeWorkspace: (workspaceId: string) => void;
  applyAppState: (
    projects: ProjectRecord[],
    workspaces: WorkspaceRecord[],
  ) => void;
}

export const useCatalogStore = create<CatalogStoreState>((set) => ({
  projects: [],
  workspaces: [],

  setProjects: (projects) =>
    set({ projects: [...projects].sort(byCreatedAtDesc) }),

  setWorkspaces: (workspaces) =>
    set({ workspaces: [...workspaces].sort(byCreatedAtDesc) }),

  patchWorkspace: (workspace) =>
    set((state) => {
      const idx = state.workspaces.findIndex((w) => w.id === workspace.id);
      const next =
        idx === -1
          ? [...state.workspaces, workspace]
          : state.workspaces.map((w, i) => (i === idx ? workspace : w));
      return { workspaces: next.sort(byCreatedAtDesc) };
    }),

  removeWorkspace: (workspaceId) =>
    set((state) => ({
      workspaces: state.workspaces.filter((w) => w.id !== workspaceId),
    })),

  applyAppState: (projects, workspaces) =>
    set({
      projects: [...projects].sort(byCreatedAtDesc),
      workspaces: [...workspaces].sort(byCreatedAtDesc),
    }),
}));
