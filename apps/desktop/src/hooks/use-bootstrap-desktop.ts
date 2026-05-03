import { useEffect, useRef } from "react";
import { startIpcEventRouting, stopIpcEventRouting } from "@/lib/services/ipc/lifecycle";
import { workspaceActions } from "@/lib/services/workspace/actions";
import { appShellPreferences } from "@/lib/services/preferences/app-shell";
import { terminalSurfaceService } from "@/lib/services/terminal/surface";

export function useBootstrapDesktop() {
  const didBootstrap = useRef(false);

  useEffect(() => {
    if (didBootstrap.current) return;
    didBootstrap.current = true;

    const init = async () => {
      await startIpcEventRouting();

      workspaceActions.init({
        removeWorkspaceSurfaces: (workspaceId) =>
          terminalSurfaceService.removeWorkspaceSurfaces(workspaceId).catch(() => {}),
      });

      await workspaceActions.loadDesktopState().catch(console.error);

      // Git subscriptions are started by workspace startup when each
      // workspace becomes ready. Snapshots arrive via IPC events and are pushed
      // into the React Query cache by applyGitSnapshot in git events.

      await appShellPreferences.hydrate().catch(console.error);
    };
    void init();

    const teardown = () => {
      void terminalSurfaceService.removeAllSurfaces().catch(console.error);
      workspaceActions.dispose();
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
