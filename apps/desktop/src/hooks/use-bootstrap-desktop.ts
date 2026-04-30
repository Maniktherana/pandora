import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { startIpcEventRouting, stopIpcEventRouting } from "@/services/ipc/ipc-lifecycle";
import { desktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";
import { uiPreferencesService } from "@/services/preferences/ui-preferences-service";
import { terminalSurfaceService } from "@/services/terminal/terminal-surface-service";
import { useCatalogStore } from "@/services/workspace/catalog-store";
import { useNavigationStore } from "@/services/workspace/navigation-store";
import { prefetchScmSummary, prefetchScmStatus } from "@/services/git/git-queries";

export function useBootstrapDesktop() {
  const queryClient = useQueryClient();
  const didBootstrap = useRef(false);

  useEffect(() => {
    if (didBootstrap.current) return;
    didBootstrap.current = true;

    const init = async () => {
      await startIpcEventRouting();

      desktopWorkspaceService.init({
        removeWorkspaceSurfaces: (workspaceId) =>
          terminalSurfaceService.removeWorkspaceSurfaces(workspaceId).catch(() => {}),
      });

      await desktopWorkspaceService.loadDesktopState().catch(console.error);

      // After the catalog is loaded, kick off Git summary prefetches for every
      // ready workspace so workspace-row Git indicators are warm immediately —
      // the user does not need to open or select a workspace first.
      const readyWorkspaces = useCatalogStore
        .getState()
        .workspaces.filter((w) => w.status === "ready");

      for (const workspace of readyWorkspaces) {
        prefetchScmSummary(queryClient, workspace.id).catch(() => {});
      }

      // Also prefetch full SCM status for the currently selected workspace so
      // the right-sidebar SCM panel is ready to render without a loading state.
      const selectedWorkspaceId = useNavigationStore.getState().selectedWorkspaceID;
      if (selectedWorkspaceId) {
        prefetchScmStatus(queryClient, selectedWorkspaceId).catch(() => {});
      }

      await uiPreferencesService.hydrate().catch(console.error);
    };
    void init();

    const teardown = () => {
      void terminalSurfaceService.removeAllSurfaces().catch(console.error);
      desktopWorkspaceService.dispose();
      stopIpcEventRouting();
    };

    window.addEventListener("beforeunload", teardown);
    window.addEventListener("pagehide", teardown);

    return () => {
      window.removeEventListener("beforeunload", teardown);
      window.removeEventListener("pagehide", teardown);
      didBootstrap.current = false;
      teardown();
    };
    // queryClient is a stable singleton from QueryClientProvider — safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
