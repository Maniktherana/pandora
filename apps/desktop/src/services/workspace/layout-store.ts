import { create } from "zustand";

import type { LayoutNode } from "@/lib/shared/types";

export interface WorkspaceLayoutState {
  root: LayoutNode | null;
  focusedPaneID: string | null;
  layoutLoading: boolean;
  layoutLoaded: boolean;
}

interface LayoutStoreState {
  byWorkspaceId: Record<string, WorkspaceLayoutState>;
  getLayout: (workspaceId: string) => WorkspaceLayoutState;
  setLayout: (workspaceId: string, layout: Partial<WorkspaceLayoutState>) => void;
  updateLayout: (
    workspaceId: string,
    updater: (current: WorkspaceLayoutState) => Partial<WorkspaceLayoutState>,
  ) => void;
  setLayoutLoading: (workspaceId: string, layoutLoading: boolean) => void;
  setLayoutLoaded: (workspaceId: string, layoutLoaded: boolean) => void;
  removeLayout: (workspaceId: string) => void;
}

function defaultWorkspaceLayoutState(): WorkspaceLayoutState {
  return {
    root: null,
    focusedPaneID: null,
    layoutLoading: false,
    layoutLoaded: false,
  };
}

export const useLayoutStore = create<LayoutStoreState>((set, get) => ({
  byWorkspaceId: {},
  getLayout: (workspaceId) => get().byWorkspaceId[workspaceId] ?? defaultWorkspaceLayoutState(),
  setLayout: (workspaceId, layout) =>
    set((s) => {
      const prev = s.byWorkspaceId[workspaceId] ?? defaultWorkspaceLayoutState();
      return {
        byWorkspaceId: {
          ...s.byWorkspaceId,
          [workspaceId]: { ...prev, ...layout },
        },
      };
    }),
  updateLayout: (workspaceId, updater) =>
    set((s) => {
      const prev = s.byWorkspaceId[workspaceId] ?? defaultWorkspaceLayoutState();
      const patch = updater(prev);
      return {
        byWorkspaceId: {
          ...s.byWorkspaceId,
          [workspaceId]: { ...prev, ...patch },
        },
      };
    }),
  setLayoutLoading: (workspaceId, layoutLoading) =>
    set((s) => {
      const prev = s.byWorkspaceId[workspaceId] ?? defaultWorkspaceLayoutState();
      return {
        byWorkspaceId: {
          ...s.byWorkspaceId,
          [workspaceId]: { ...prev, layoutLoading },
        },
      };
    }),
  setLayoutLoaded: (workspaceId, layoutLoaded) =>
    set((s) => {
      const prev = s.byWorkspaceId[workspaceId] ?? defaultWorkspaceLayoutState();
      return {
        byWorkspaceId: {
          ...s.byWorkspaceId,
          [workspaceId]: { ...prev, layoutLoaded },
        },
      };
    }),
  removeLayout: (workspaceId) =>
    set((s) => {
      const { [workspaceId]: _removed, ...rest } = s.byWorkspaceId;
      return { byWorkspaceId: rest };
    }),
}));
