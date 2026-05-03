import { useCatalogStore } from "@/lib/services/catalog/store";
import { useNavigationStore, type NavigationArea } from "@/lib/services/navigation/store";
import {
  saveSelection,
  markWorkspaceOpened as apiMarkWorkspaceOpened,
} from "@/lib/services/workspace/api";
import { workspaceSelectionError } from "@/lib/services/workspace/crud";

// ─── selection target state ───────────────────────────────────────────────────
// Tracks where navigation is heading during rapid selection, so that relative
// navigation (e.g. arrow keys) stays coherent before the store commits.

export let selectionTargetWorkspaceID: string | null = null;

export function setSelectionTarget(workspaceId: string | null): void {
  selectionTargetWorkspaceID = workspaceId;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

export function getVisibleSidebarWorkspaces() {
  const { projects, workspaces } = useCatalogStore.getState();
  return projects.flatMap((project) =>
    workspaces.filter(
      (workspace) =>
        workspace.projectId === project.id && workspace.status !== "archived",
    ),
  );
}

function applyWorkspaceSelection(
  workspaceId: string,
  projectId: string,
  navigationArea: NavigationArea = "sidebar",
): void {
  selectionTargetWorkspaceID = workspaceId;
  useNavigationStore.getState().selectWorkspace(workspaceId, projectId);
  if (navigationArea !== "sidebar") {
    useNavigationStore.getState().setNavigationArea(navigationArea);
  } else {
    useNavigationStore.getState().setLayoutTargetScopeId(null);
  }
}

// ─── selection functions ──────────────────────────────────────────────────────
// Selection only updates navigation state and persists the choice.
// Background workspace startup is the caller's responsibility.

export async function selectWorkspaceById(
  workspaceId: string,
  navigationArea: NavigationArea = "sidebar",
): Promise<void> {
  const workspace = useCatalogStore.getState().workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace)
    throw workspaceSelectionError(new Error("Workspace not found"), workspaceId);

  applyWorkspaceSelection(workspace.id, workspace.projectId, navigationArea);
  saveSelection(workspace.projectId, workspace.id).catch((err) =>
    console.warn("Failed to save workspace selection:", err),
  );
  apiMarkWorkspaceOpened(workspace.id).catch((err) =>
    console.warn("Failed to mark workspace opened:", err),
  );
}

export async function selectWorkspaceRelative(
  offset: number,
  navigationArea: NavigationArea = "sidebar",
): Promise<void> {
  const visibleWorkspaces = getVisibleSidebarWorkspaces();
  if (visibleWorkspaces.length === 0) return;
  const currentSelectedId =
    selectionTargetWorkspaceID ?? useNavigationStore.getState().selectedWorkspaceID;
  const currentIndex = visibleWorkspaces.findIndex(
    (workspace) => workspace.id === currentSelectedId,
  );
  const nextIndex = Math.max(
    0,
    Math.min(visibleWorkspaces.length - 1, (currentIndex >= 0 ? currentIndex : 0) + offset),
  );
  const workspace = visibleWorkspaces[nextIndex];
  if (!workspace) return;
  await selectWorkspaceById(workspace.id);
  if (navigationArea !== "sidebar") {
    useNavigationStore.getState().setNavigationArea(navigationArea);
  }
}
