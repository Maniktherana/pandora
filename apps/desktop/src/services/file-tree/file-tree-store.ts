import { create } from "zustand";
import type { FileTreeEntry } from "@/lib/shared/types";

export type FileTreeBootStatus = "idle" | "loading" | "loaded" | "error";

export interface FileTreeRuntimeState {
  rootPath: string;
  bootStatus: FileTreeBootStatus;
  directories: Record<string, FileTreeEntry[]>;
  expandedPaths: Set<string>;
  lastError: string | null;
}

function emptyFileTreeState(): FileTreeRuntimeState {
  return {
    rootPath: "",
    bootStatus: "idle",
    directories: {},
    expandedPaths: new Set(),
    lastError: null,
  };
}

interface FileTreeStoreState {
  byScopeId: Record<string, FileTreeRuntimeState>;
  setBootLoading: (scopeId: string) => void;
  applySnapshot: (
    scopeId: string,
    rootPath: string,
    directories: Record<string, FileTreeEntry[]>,
    expandedPaths: string[],
  ) => void;
  applyDirectoryChanged: (scopeId: string, path: string, entries: FileTreeEntry[]) => void;
  setExpandedPaths: (scopeId: string, paths: Set<string>) => void;
  toggleExpanded: (scopeId: string, relPath: string, expanded: boolean) => void;
  setError: (scopeId: string, error: string, options?: { forceErrorStatus?: boolean }) => void;
  resetScope: (scopeId: string) => void;
}

export const useFileTreeStore = create<FileTreeStoreState>((set) => ({
  byScopeId: {},

  setBootLoading: (scopeId) =>
    set((s) => {
      const current = s.byScopeId[scopeId] ?? emptyFileTreeState();
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: { ...current, bootStatus: "loading" },
        },
      };
    }),

  applySnapshot: (scopeId, rootPath, directories, expandedPaths) =>
    set((s) => {
      const paths = new Set(expandedPaths);
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            ...(s.byScopeId[scopeId] ?? emptyFileTreeState()),
            rootPath,
            bootStatus: "loaded",
            directories,
            expandedPaths: paths,
            lastError: null,
          },
        },
      };
    }),

  applyDirectoryChanged: (scopeId, path, entries) =>
    set((s) => {
      const current = s.byScopeId[scopeId] ?? emptyFileTreeState();
      const directories = { ...current.directories, [path]: entries };
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            ...current,
            directories,
          },
        },
      };
    }),

  setExpandedPaths: (scopeId, paths) =>
    set((s) => {
      const current = s.byScopeId[scopeId] ?? emptyFileTreeState();
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            ...current,
            expandedPaths: paths,
          },
        },
      };
    }),

  toggleExpanded: (scopeId, relPath, expanded) =>
    set((s) => {
      const current = s.byScopeId[scopeId] ?? emptyFileTreeState();
      const paths = new Set(current.expandedPaths);
      if (expanded) paths.add(relPath);
      else paths.delete(relPath);
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            ...current,
            expandedPaths: paths,
          },
        },
      };
    }),

  setError: (scopeId, error, options) =>
    set((s) => {
      const current = s.byScopeId[scopeId] ?? emptyFileTreeState();
      const rootDirectoryExists =
        current.directories[""] !== undefined && current.directories[""] !== null;
      const shouldErrorStatus =
        options?.forceErrorStatus ||
        (current.bootStatus !== "loaded" && !rootDirectoryExists);
      return {
        byScopeId: {
          ...s.byScopeId,
          [scopeId]: {
            ...current,
            bootStatus: shouldErrorStatus ? "error" : current.bootStatus,
            lastError: error,
          },
        },
      };
    }),

  resetScope: (scopeId) =>
    set((s) => {
      const next = { ...s.byScopeId };
      delete next[scopeId];
      return { byScopeId: next };
    }),
}));
