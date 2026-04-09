import { invoke } from "@tauri-apps/api/core";
import { useQuery } from "@tanstack/react-query";
import type { DirEntry } from "./files.types";

export function fileTreeQueryKey(workspaceId: string, workspaceRoot: string) {
  return ["workspace-file-tree", workspaceId, workspaceRoot] as const;
}

export function fileTreeDirectoryQueryKey(
  workspaceId: string,
  workspaceRoot: string,
  relativePath: string,
) {
  return [...fileTreeQueryKey(workspaceId, workspaceRoot), relativePath] as const;
}

export function listWorkspaceDirectory(
  workspaceRoot: string,
  relativePath: string,
): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_workspace_directory", {
    workspaceRoot,
    relativePath,
  });
}

export function useWorkspaceDirectoryQuery({
  workspaceId,
  workspaceRoot,
  relativePath,
  enabled = true,
}: {
  workspaceId: string;
  workspaceRoot: string;
  relativePath: string;
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: fileTreeDirectoryQueryKey(workspaceId, workspaceRoot, relativePath),
    queryFn: () => listWorkspaceDirectory(workspaceRoot, relativePath),
    enabled,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
  });
}
