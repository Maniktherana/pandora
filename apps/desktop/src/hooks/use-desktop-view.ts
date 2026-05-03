import { useNavigationStore } from "@/lib/services/navigation/store";
import { useCatalogStore } from "@/lib/services/catalog/store";
import type { WorkspaceRecord } from "@/lib/shared/shared.types";

export interface WorkspaceView {
  readonly workspaceId: string;
  readonly workspace: WorkspaceRecord | null;
  readonly isSelected: boolean;
}

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
