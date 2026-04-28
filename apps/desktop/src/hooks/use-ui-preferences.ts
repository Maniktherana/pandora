import { useMemo } from "react";
import { uiPreferencesService } from "@/services/preferences/ui-preferences-service";
export { useUiPreferencesView } from "./use-desktop-view";

export function useUiPreferencesActions() {
  return useMemo(
    () => ({
      setSidebarVisible: (visible: boolean) =>
        void uiPreferencesService.setSidebarVisible(visible).catch(console.error),
      syncSelectedWorkspace: (workspaceId: string | null, ready: boolean) =>
        uiPreferencesService.syncSelectedWorkspace(workspaceId, ready),
      setFileTreeOpen: (open: boolean) =>
        void uiPreferencesService.setFileTreeOpen(open).catch(console.error),
    }),
    [],
  );
}
