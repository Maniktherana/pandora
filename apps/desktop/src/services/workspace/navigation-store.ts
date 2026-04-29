import { create } from "zustand";

type NavigationArea = "sidebar" | "workspace";

interface NavigationStoreState {
  selectedProjectID: string | null;
  selectedWorkspaceID: string | null;
  navigationArea: NavigationArea;
  layoutTargetScopeId: string | null;
  searchText: string;

  selectWorkspace: (workspaceId: string, projectId: string) => void;
  selectProject: (projectId: string) => void;
  setNavigationArea: (area: NavigationArea) => void;
  setLayoutTargetScopeId: (scopeId: string | null) => void;
  setSearchText: (text: string) => void;
  clearSelection: () => void;
}

export const useNavigationStore = create<NavigationStoreState>((set) => ({
  selectedProjectID: null,
  selectedWorkspaceID: null,
  navigationArea: "sidebar",
  layoutTargetScopeId: null,
  searchText: "",

  selectWorkspace: (workspaceId, projectId) =>
    set({
      selectedWorkspaceID: workspaceId,
      selectedProjectID: projectId,
      layoutTargetScopeId: null,
      navigationArea: "sidebar",
    }),

  selectProject: (projectId) => set({ selectedProjectID: projectId }),

  setNavigationArea: (area) => set({ navigationArea: area }),

  setLayoutTargetScopeId: (scopeId) =>
    set({ layoutTargetScopeId: scopeId }),

  setSearchText: (text) => set({ searchText: text }),

  clearSelection: () =>
    set({
      selectedProjectID: null,
      selectedWorkspaceID: null,
    }),
}));
