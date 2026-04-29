import { useEffect, useRef } from "react";
import { startIpcEventRouting, stopIpcEventRouting } from "@/services/ipc/ipc-lifecycle";
import { desktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";
import { uiPreferencesService } from "@/services/preferences/ui-preferences-service";
import { terminalSurfaceService } from "@/services/terminal/terminal-surface-service";

export function useBootstrapDesktop() {
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
  }, []);
}
