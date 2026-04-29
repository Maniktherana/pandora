import { create } from "zustand";
import type { FileTreeEntry } from "@/lib/shared/types";
import type { FileTreeVisibleRow } from "./file-tree-types";
import { buildVisibleRows } from "./file-tree-projection";

export type FileTreeBootStatus = "idle" | "loading" | "loaded" | "error";

export interface FileTreeRuntimeState {
  rootPath: string;
  bootStatus: FileTreeBootStatus;
  directories: Record<string, FileTreeEntry[]>;
  expandedPaths: Set<string>;
  /** Flat ordered row list — recomputed synchronously on every tree/expansion mutation. */
  visibleRows: FileTreeVisibleRow[];
  lastError: string | null;
}

const EMPTY_VISIBLE_ROWS: FileTreeVisibleRow[] = [];

function emptyFileTreeState(): FileTreeRuntimeState {
  return {
    rootPath: "",
    bootStatus: "idle",
    directories: {},
    expandedPaths: new Set(),
    visibleRows: EMPTY_VISIBLE_ROWS,
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
            visibleRows: buildVisibleRows(directories, paths),
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
            visibleRows: buildVisibleRows(directories, current.expandedPaths),
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
            visibleRows: buildVisibleRows(current.directories, paths),
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
