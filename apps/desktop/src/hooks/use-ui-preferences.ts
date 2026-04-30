import { useMemo } from "react";
import { uiPreferencesService } from "@/services/preferences/ui-preferences-service";
import {
  useUiPreferencesStore,
  type UiPreferencesView,
} from "@/services/preferences/ui-preferences-store";

export function useUiPreferences<T = UiPreferencesView>(
  selector?: (prefs: UiPreferencesView) => T,
): T {
  return useUiPreferencesStore((state) =>
    selector ? selector(state.uiPreferences) : (state.uiPreferences as T),
  );
}

export function useUiPreferencesActions() {
  return useMemo(
    () => ({
      setSidebarVisible: (visible: boolean) => uiPreferencesService.setSidebarVisible(visible),
      syncSelectedWorkspace: (workspaceId: string | null, ready: boolean) =>
        uiPreferencesService.syncSelectedWorkspace(workspaceId, ready),
      setFileTreeOpen: (open: boolean) => uiPreferencesService.setFileTreeOpen(open),
    }),
    [],
  );
}
