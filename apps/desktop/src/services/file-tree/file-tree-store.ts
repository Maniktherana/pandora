import { create } from "zustand";
import type { FileTreeEntry } from "@/lib/shared/types";

export interface FileTreeRuntimeState {
  rootPath: string;
  directories: Record<string, FileTreeEntry[]>;
  expandedPaths: Set<string>;
  lastError: string | null;
}

function emptyFileTreeState(): FileTreeRuntimeState {
  return { rootPath: "", directories: {}, expandedPaths: new Set(), lastError: null };
}

interface FileTreeStoreState {
  byRuntimeId: Record<string, FileTreeRuntimeState>;
  applySnapshot: (
    runtimeId: string,
    rootPath: string,
    directories: Record<string, FileTreeEntry[]>,
    expandedPaths: string[],
  ) => void;
  applyDirectoryChanged: (runtimeId: string, path: string, entries: FileTreeEntry[]) => void;
  setExpandedPaths: (runtimeId: string, paths: Set<string>) => void;
  setError: (runtimeId: string, error: string | null) => void;
  resetRuntime: (runtimeId: string) => void;
}

export const useFileTreeStore = create<FileTreeStoreState>((set) => ({
  byRuntimeId: {},

  applySnapshot: (runtimeId, rootPath, directories, expandedPaths) =>
    set((s) => ({
      byRuntimeId: {
        ...s.byRuntimeId,
        [runtimeId]: {
          ...(s.byRuntimeId[runtimeId] ?? emptyFileTreeState()),
          rootPath,
          directories,
          expandedPaths: new Set(expandedPaths),
          lastError: null,
        },
      },
    })),

  applyDirectoryChanged: (runtimeId, path, entries) =>
    set((s) => {
      const current = s.byRuntimeId[runtimeId] ?? emptyFileTreeState();
      return {
        byRuntimeId: {
          ...s.byRuntimeId,
          [runtimeId]: { ...current, directories: { ...current.directories, [path]: entries } },
        },
      };
    }),

  setExpandedPaths: (runtimeId, paths) =>
    set((s) => {
      const current = s.byRuntimeId[runtimeId] ?? emptyFileTreeState();
      return {
        byRuntimeId: { ...s.byRuntimeId, [runtimeId]: { ...current, expandedPaths: paths } },
      };
    }),

  setError: (runtimeId, error) =>
    set((s) => {
      const current = s.byRuntimeId[runtimeId] ?? emptyFileTreeState();
      return {
        byRuntimeId: { ...s.byRuntimeId, [runtimeId]: { ...current, lastError: error } },
      };
    }),

  resetRuntime: (runtimeId) =>
    set((s) => {
      const next = { ...s.byRuntimeId };
      delete next[runtimeId];
      return { byRuntimeId: next };
    }),
}));
