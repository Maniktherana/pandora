import { useNavigationStore } from "@/services/workspace/navigation-store";
import { useCatalogStore } from "@/services/workspace/catalog-store";
import type { NavigationArea } from "@/services/workspace/desktop-view-projections";

export function useProjects() {
  return useCatalogStore((s) => s.projects);
}

export function useWorkspaces() {
  return useCatalogStore((s) => s.workspaces);
}

export function useSelectedProjectId(): string | null {
  return useNavigationStore((s) => s.selectedProjectID);
}

export function useSelectedWorkspaceId(): string | null {
  return useNavigationStore((s) => s.selectedWorkspaceID);
}

export function useSelectedProject() {
  const projectId = useNavigationStore((s) => s.selectedProjectID);
  return useCatalogStore((s) =>
    projectId ? (s.projects.find((p) => p.id === projectId) ?? null) : null,
  );
}

export function useSelectedWorkspace() {
  const workspaceId = useNavigationStore((s) => s.selectedWorkspaceID);
  return useCatalogStore((s) =>
    workspaceId ? (s.workspaces.find((w) => w.id === workspaceId) ?? null) : null,
  );
}

export function useNavigationArea(): NavigationArea {
  return useNavigationStore((s) => s.navigationArea);
}

export function useSearchText(): string {
  return useNavigationStore((s) => s.searchText);
}

export function useLayoutTargetScopeId(): string | null {
  return useNavigationStore((s) => s.layoutTargetScopeId);
}
