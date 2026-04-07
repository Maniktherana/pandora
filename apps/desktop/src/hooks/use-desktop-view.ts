import type {
  DesktopView,
  ProjectTerminalView,
  UiPreferencesView,
  WorkspaceView,
} from "@/state/desktop-view-projections";
import { buildProjectTerminalView, buildWorkspaceView } from "@/state/desktop-view-projections";
import { useDesktopViewStore } from "@/state/desktop-view-store";

export function useDesktopView<T = DesktopView>(selector?: (view: DesktopView) => T) {
  return useDesktopViewStore((state) =>
    selector ? selector(state.desktopView) : (state.desktopView as T),
  );
}

export function useUiPreferencesView<T = UiPreferencesView>(
  selector?: (view: UiPreferencesView) => T,
) {
  return useDesktopViewStore((state) =>
    selector ? selector(state.uiPreferences) : (state.uiPreferences as T),
  );
}

export function useWorkspaceView<T = WorkspaceView>(
  workspaceId: string,
  selector?: (view: WorkspaceView) => T,
) {
  return useDesktopViewStore((state) => {
    const view = buildWorkspaceView(state.desktopView, workspaceId);
    return selector ? selector(view) : (view as T);
  });
}

export function useProjectTerminalView<T = ProjectTerminalView>(
  runtimeId: string,
  selector?: (view: ProjectTerminalView) => T,
) {
  return useDesktopViewStore((state) => {
    const view = buildProjectTerminalView(state.desktopView, runtimeId);
    return selector ? selector(view) : (view as T);
  });
}
