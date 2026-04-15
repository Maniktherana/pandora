import { Effect } from "effect";
import { useMemo } from "react";
import { DaemonGateway } from "@/services/daemon/daemon-gateway";
import { DesktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";
import type { DesktopViewStateSnapshot } from "@/state/desktop-view-projections";
import { useDesktopEffectRunner } from "./use-bootstrap-desktop";

export function useWorkspaceActions() {
  const { run, runPromise } = useDesktopEffectRunner();

  return useMemo(
    () => ({
      loadDesktopState: () =>
        run(Effect.flatMap(DesktopWorkspaceService, (service) => service.loadDesktopState())),
      addProject: (path: string) =>
        run(Effect.flatMap(DesktopWorkspaceService, (service) => service.addProject(path))),
      toggleProject: (projectId: string) =>
        run(Effect.flatMap(DesktopWorkspaceService, (service) => service.toggleProject(projectId))),
      removeProject: (projectId: string) =>
        run(Effect.flatMap(DesktopWorkspaceService, (service) => service.removeProject(projectId))),
      selectProject: (projectId: string) =>
        run(Effect.flatMap(DesktopWorkspaceService, (service) => service.selectProject(projectId))),
      selectWorkspace: (workspaceId: string) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.selectWorkspace(workspaceId),
          ),
        ),
      activateSidebarSelection: () =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) => service.activateSidebarSelection()),
        ),
      navigateSidebar: (offset: number) =>
        run(Effect.flatMap(DesktopWorkspaceService, (service) => service.navigateSidebar(offset))),
      switchWorkspaceRelative: (
        offset: number,
        navigationArea?: DesktopViewStateSnapshot["navigationArea"],
      ) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.switchWorkspaceRelative(offset, navigationArea),
          ),
        ),
      setNavigationArea: (area: DesktopViewStateSnapshot["navigationArea"]) =>
        run(Effect.flatMap(DesktopWorkspaceService, (service) => service.setNavigationArea(area))),
      setSearchText: (text: string) =>
        run(Effect.flatMap(DesktopWorkspaceService, (service) => service.setSearchText(text))),
      setLayoutTargetRuntimeId: (runtimeId: string | null) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.setLayoutTargetRuntimeId(runtimeId),
          ),
        ),
      createWorkspace: (projectId: string, workspaceKind?: "worktree" | "linked") =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.createWorkspace(projectId, workspaceKind),
          ),
        ),
      retryWorkspace: (workspaceId: string) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) => service.retryWorkspace(workspaceId)),
        ),
      renameWorkspace: (workspaceId: string, name: string) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.renameWorkspace(workspaceId, name),
          ),
        ),
      updateWorkspacePrState: (workspaceId: string, prState: string) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.updateWorkspacePrState(workspaceId, prState),
          ),
        ),
      setPrAwaiting: (workspaceId: string, awaiting: boolean) =>
        run(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.setPrAwaiting(workspaceId, awaiting),
          ),
        ),
      archiveWorkspace: (workspaceId: string, options?: { deleteWorktree?: boolean }) =>
        runPromise(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.archiveWorkspace(workspaceId, options),
          ),
        ),
      restoreWorkspace: (workspaceId: string) =>
        runPromise(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.restoreWorkspace(workspaceId),
          ),
        ),
      removeWorkspace: (workspaceId: string) =>
        runPromise(
          Effect.flatMap(DesktopWorkspaceService, (service) =>
            service.removeWorkspace(workspaceId),
          ),
        ),
      connectDaemon: () => run(Effect.flatMap(DaemonGateway, (gateway) => gateway.connect())),
      disconnectDaemon: () => run(Effect.flatMap(DaemonGateway, (gateway) => gateway.disconnect())),
    }),
    [run, runPromise],
  );
}
