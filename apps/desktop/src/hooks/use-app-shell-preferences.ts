import { useMemo } from "react";
import { appShellPreferences } from "@/lib/services/preferences/app-shell";
import {
  useAppShellPreferencesStore,
  type AppShellPreferencesView,
} from "@/lib/services/preferences/app-shell-store";

export function useAppShellPreferences<T = AppShellPreferencesView>(
  selector?: (prefs: AppShellPreferencesView) => T,
): T {
  return useAppShellPreferencesStore((state) =>
    selector ? selector(state.appShellPreferences) : (state.appShellPreferences as T),
  );
}

export function useAppShellPreferencesActions() {
  return useMemo(
    () => ({
      setLeftSidebarVisible: (visible: boolean) => appShellPreferences.setLeftSidebarVisible(visible),
      syncSelectedWorkspace: (workspaceId: string | null, ready: boolean) =>
        appShellPreferences.syncSelectedWorkspace(workspaceId, ready),
      setRightSidebarOpen: (open: boolean) => appShellPreferences.setRightSidebarOpen(open),
    }),
    [],
  );
}
