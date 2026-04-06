import { Effect } from "effect";
import { useMemo } from "react";
import { UiPreferencesService } from "@/services/preferences/ui-preferences-service";
import { useDesktopEffectRunner } from "./use-bootstrap-desktop";
export { useUiPreferencesView } from "./use-desktop-view";

export function useUiPreferencesActions() {
  const { run } = useDesktopEffectRunner();

  return useMemo(
    () => ({
      setSidebarVisible: (visible: boolean) =>
        run(Effect.flatMap(UiPreferencesService, (prefs) => prefs.setSidebarVisible(visible))),
      syncSelectedWorkspace: (workspaceId: string | null, ready: boolean) =>
        run(
          Effect.flatMap(UiPreferencesService, (prefs) =>
            prefs.syncSelectedWorkspace(workspaceId, ready)
          )
        ),
      setFileTreeOpenForWorkspace: (workspaceId: string, open: boolean) =>
        run(
          Effect.flatMap(UiPreferencesService, (prefs) =>
            prefs.setFileTreeOpenForWorkspace(workspaceId, open)
          )
        ),
    }),
    [run]
  );
}
