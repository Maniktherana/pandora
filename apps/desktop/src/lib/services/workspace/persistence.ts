import { saveWorkspaceLayout } from "./api";
import { useLayoutStore } from "@/lib/services/layout/store";

export async function persistWorkspaceLayout(workspaceId: string): Promise<void> {
  const workspaceLayout = useLayoutStore.getState().getLayout(workspaceId);
  const root =
    workspaceLayout.root?.type === "leaf" && workspaceLayout.root.tabs.length === 0
      ? null
      : workspaceLayout.root;
  const layout = {
    root,
    focusedPaneID: root ? workspaceLayout.focusedPaneID : null,
  };
  try {
    await saveWorkspaceLayout(workspaceId, layout);
  } catch {
    // best-effort
  }
}
