import type {
  DesktopView,
  UiPreferencesView,
  WorkspaceView,
} from "@/state/desktop-view-projections";
import { buildWorkspaceView } from "@/state/desktop-view-projections";
import { useDesktopViewStore } from "@/state/desktop-view-store";
import { useRuntimeStore } from "@/state/runtime-store";
import type { WorkspaceRuntimeState } from "@/lib/shared/types";

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

export function useRuntimeState<T = WorkspaceRuntimeState | null>(
  runtimeId: string,
  selector?: (runtime: WorkspaceRuntimeState | null) => T,
) {
  return useRuntimeStore((state) => {
    const runtime = runtimeId ? (state.runtimeState[runtimeId] ?? null) : null;
    return selector ? selector(runtime) : (runtime as T);
  });
}
