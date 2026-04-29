import type { WorkspaceView } from "@/services/workspace/desktop-view-projections";
import { useNavigationStore } from "@/services/workspace/navigation-store";
import { useCatalogStore } from "@/services/workspace/catalog-store";

export function useWorkspaceView<T = WorkspaceView>(
  workspaceId: string,
  selector?: (view: WorkspaceView) => T,
) {
  const workspace = useCatalogStore((s) => s.workspaces.find((w) => w.id === workspaceId) ?? null);
  const selectedWorkspaceID = useNavigationStore((s) => s.selectedWorkspaceID);
  const view: WorkspaceView = {
    workspaceId,
    workspace,
    isSelected: selectedWorkspaceID === workspaceId,
  };
  return selector ? selector(view) : (view as T);
}
