import { Effect } from "effect";
import { useCallback, useMemo } from "react";
import type {
  AppViewModel,
  ProjectTerminalViewModel,
  UiPreferencesViewModel,
  WorkspaceViewModel,
} from "@/lib/effect/view-model";
import { useAppViewStore } from "@/stores/app-view-store";
import { useAppRuntime } from "./use-app-runtime";
import { DaemonGateway } from "@/lib/effect/services/daemon-gateway";
import { UiPreferences } from "@/lib/effect/services/ui-preferences";
import { WorkspaceRegistry } from "@/lib/effect/services/workspace-registry";
import { getTerminalDaemonClient } from "@/lib/terminal/terminal-runtime";
import { seedProjectTerminal, seedWorkspaceTerminal } from "@/lib/terminal/terminal-seed";
import { findLeaf } from "@/lib/layout/layout-migrate";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { tryCloseEditorTab } from "@/lib/editor/close-dirty-editor";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { WorkspaceStoreState } from "@/stores/workspace-store";

export function useAppView<T = AppViewModel>(selector?: (view: AppViewModel) => T) {
  return useAppViewStore((state) => (selector ? selector(state.appView) : (state.appView as T)));
}

export function useUiPreferencesView<T = UiPreferencesViewModel>(
  selector?: (view: UiPreferencesViewModel) => T
) {
  return useAppViewStore((state) =>
    selector ? selector(state.uiPreferences) : (state.uiPreferences as T)
  );
}

export function useWorkspaceView<T = WorkspaceViewModel>(
  workspaceId: string,
  selector?: (view: WorkspaceViewModel) => T
) {
  return useAppViewStore((state) => {
    const appView = state.appView;
    const view: WorkspaceViewModel = {
      workspaceId,
      workspace: appView.workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
      runtime: appView.runtimes[workspaceId] ?? null,
      isSelected: appView.selectedWorkspaceID === workspaceId,
    };
    return selector ? selector(view) : (view as T);
  });
}

export function useProjectTerminalView<T = ProjectTerminalViewModel>(
  runtimeId: string,
  selector?: (view: ProjectTerminalViewModel) => T
) {
  return useAppViewStore((state) => {
    const appView = state.appView;
    const view: ProjectTerminalViewModel = {
      runtimeId,
      runtime: appView.runtimes[runtimeId] ?? null,
    };
    return selector ? selector(view) : (view as T);
  });
}

function useRuntimeCommandRunner() {
  const runtime = useAppRuntime();

  return useCallback(
    <A, E, R>(effect: Effect.Effect<A, E, R>) => {
      void runtime.runPromise(effect as Effect.Effect<A, E, never>);
    },
    [runtime]
  );
}

export function useWorkspaceCommands() {
  const run = useRuntimeCommandRunner();

  return useMemo(
    () => ({
      loadAppState: () =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) => registry.loadAppState())
        ),
      addProject: (path: string) =>
        run(Effect.flatMap(WorkspaceRegistry, (registry) => registry.addProject(path))),
      toggleProject: (projectId: string) =>
        run(Effect.flatMap(WorkspaceRegistry, (registry) => registry.toggleProject(projectId))),
      removeProject: (projectId: string) =>
        run(Effect.flatMap(WorkspaceRegistry, (registry) => registry.removeProject(projectId))),
      selectProject: (projectId: string) =>
        run(Effect.flatMap(WorkspaceRegistry, (registry) => registry.selectProject(projectId))),
      selectWorkspace: (workspaceId: string) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) => registry.selectWorkspace(workspaceId))
        ),
      activateSidebarSelection: () =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) => registry.activateSidebarSelection())
        ),
      navigateSidebar: (offset: number) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) => registry.navigateSidebar(offset))
        ),
      setNavigationArea: (area: WorkspaceStoreState["navigationArea"]) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) => registry.setNavigationArea(area))
        ),
      setSearchText: (text: string) =>
        run(Effect.flatMap(WorkspaceRegistry, (registry) => registry.setSearchText(text))),
      setLayoutTargetRuntimeId: (runtimeId: string | null) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.setLayoutTargetRuntimeId(runtimeId)
          )
        ),
      createWorkspace: (projectId: string, workspaceKind?: "worktree" | "linked") =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.createWorkspace(projectId, workspaceKind)
          )
        ),
      retryWorkspace: (workspaceId: string) =>
        run(Effect.flatMap(WorkspaceRegistry, (registry) => registry.retryWorkspace(workspaceId))),
      removeWorkspace: (workspaceId: string) =>
        run(Effect.flatMap(WorkspaceRegistry, (registry) => registry.removeWorkspace(workspaceId))),
      updateWorkspacePrState: (workspaceId: string, prState: string) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.updateWorkspacePrState(workspaceId, prState)
          )
        ),
      setPrAwaiting: (workspaceId: string, awaiting: boolean) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.setPrAwaiting(workspaceId, awaiting)
          )
        ),
      archiveWorkspace: (workspaceId: string) =>
        run(Effect.flatMap(WorkspaceRegistry, (registry) => registry.archiveWorkspace(workspaceId))),
      connectDaemon: () =>
        run(
          Effect.flatMap(DaemonGateway, (gateway) => gateway.connect())
        ),
      disconnectDaemon: () =>
        run(
          Effect.flatMap(DaemonGateway, (gateway) => gateway.disconnect())
        ),
    }),
    [run]
  );
}

export function useLayoutCommands() {
  const run = useRuntimeCommandRunner();
  const selectedWorkspaceID = useAppView((view) => view.selectedWorkspaceID);

  return useMemo(
    () => ({
      cycleTab: (direction: -1 | 1) =>
        run(Effect.flatMap(WorkspaceRegistry, (registry) => registry.cycleTab(direction))),
      splitPane: (
        targetPaneID: string,
        sourcePaneID: string,
        sourceTabIndex: number,
        axis: "horizontal" | "vertical",
        position: "before" | "after"
      ) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            selectedWorkspaceID
              ? Effect.flatMap(
                  registry.getWorkspaceSession(selectedWorkspaceID),
                  (session) =>
                    session.commands.splitPane(
                      targetPaneID,
                      sourcePaneID,
                      sourceTabIndex,
                      axis,
                      position
                    )
                )
              : Effect.void
          )
        ),
      addTabToPane: (targetPaneID: string, sourcePaneID: string, sourceTabIndex: number) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            selectedWorkspaceID
              ? Effect.flatMap(
                  registry.getWorkspaceSession(selectedWorkspaceID),
                  (session) => session.commands.addTabToPane(targetPaneID, sourcePaneID, sourceTabIndex)
                )
              : Effect.void
          )
        ),
      removePaneTabByIndex: (paneID: string, tabIndex: number) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            selectedWorkspaceID
              ? Effect.flatMap(
                  registry.getWorkspaceSession(selectedWorkspaceID),
                  (session) => session.commands.removeTab(paneID, tabIndex)
                )
              : Effect.void
          )
        ),
      selectTabInPane: (paneID: string, index: number) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            selectedWorkspaceID
              ? Effect.flatMap(
                  registry.getWorkspaceSession(selectedWorkspaceID),
                  (session) => session.commands.selectTabInPane(paneID, index)
                )
              : Effect.void
          )
        ),
      setFocusedPane: (paneId: string) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            selectedWorkspaceID
              ? Effect.flatMap(
                  registry.getWorkspaceSession(selectedWorkspaceID),
                  (session) => session.commands.focusPane(paneId)
                )
              : Effect.void
          )
        ),
      moveTab: (fromPaneID: string, toPaneID: string, fromIndex: number, toIndex: number) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            selectedWorkspaceID
              ? Effect.flatMap(
                  registry.getWorkspaceSession(selectedWorkspaceID),
                  (session) => session.commands.moveTab(fromPaneID, toPaneID, fromIndex, toIndex)
                )
              : Effect.void
          )
        ),
      reorderTab: (paneID: string, fromIndex: number, toIndex: number) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            selectedWorkspaceID
              ? Effect.flatMap(
                  registry.getWorkspaceSession(selectedWorkspaceID),
                  (session) => session.commands.reorderTab(paneID, fromIndex, toIndex)
                )
              : Effect.void
          )
        ),
      addDiffTabForPath: (relativePath: string, source: "working" | "staged") =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.addDiffTabForPath(relativePath, source)
          )
        ),
    }),
    [run, selectedWorkspaceID]
  );
}

export function useUiPreferencesCommands() {
  const run = useRuntimeCommandRunner();

  return useMemo(
    () => ({
      setSidebarVisible: (visible: boolean) =>
        run(Effect.flatMap(UiPreferences, (prefs) => prefs.setSidebarVisible(visible))),
      syncSelectedWorkspace: (workspaceId: string | null, ready: boolean) =>
        run(Effect.flatMap(UiPreferences, (prefs) => prefs.syncSelectedWorkspace(workspaceId, ready))),
      setFileTreeOpenForWorkspace: (workspaceId: string, open: boolean) =>
        run(
          Effect.flatMap(UiPreferences, (prefs) =>
            prefs.setFileTreeOpenForWorkspace(workspaceId, open)
          )
        ),
    }),
    [run]
  );
}

export function useTerminalCommands() {
  return useMemo(
    () => ({
      newTerminal() {
        const client = getTerminalDaemonClient();
        const state = useWorkspaceStore.getState();
        const runtimeId = state.effectiveLayoutRuntimeId() ?? state.selectedWorkspaceID;
        if (!client || !runtimeId) return;

        if (isProjectRuntimeKey(runtimeId)) {
          const seeded = seedProjectTerminal(client, runtimeId);
          state.addProjectTerminalGroup(runtimeId, seeded.slotID);
          state.setProjectTerminalPanelVisible(runtimeId, true);
          return;
        }

        seedWorkspaceTerminal(client, runtimeId);
      },

      closeFocusedTab() {
        const client = getTerminalDaemonClient();
        const state = useWorkspaceStore.getState();
        const runtimeId = state.effectiveLayoutRuntimeId();
        if (!runtimeId) return;

        const runtime = state.runtimes[runtimeId];
        if (!runtime) return;

        if (isProjectRuntimeKey(runtimeId)) {
          const slotId = runtime.terminalPanel?.activeSlotId;
          if (!slotId || !client) return;
          state.closeProjectTerminal(runtimeId, slotId);
          return;
        }

        if (!runtime.root || !runtime.focusedPaneID) return;
        const leaf = findLeaf(runtime.root, runtime.focusedPaneID);
        if (!leaf || leaf.tabs.length === 0) return;

        const idx = leaf.selectedIndex;
        const tab = leaf.tabs[idx] ?? leaf.tabs[0];
        if (!tab) return;

        if (tab.kind === "terminal") {
          if (!client) return;
          client.send(runtimeId, {
            type: "remove_slot",
            slotID: tab.slotId,
          });
          return;
        }

        if (tab.kind === "diff") {
          state.removePaneTabByIndex(runtime.focusedPaneID, idx);
          return;
        }

        if (isProjectRuntimeKey(runtimeId)) return;
        const ws = state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceID);
        if (!ws || ws.status !== "ready") return;
        const label = tab.path.split("/").pop() ?? tab.path;
        void tryCloseEditorTab({
          workspaceId: ws.id,
          workspaceRoot: ws.worktreePath,
          paneID: runtime.focusedPaneID,
          tabIndex: idx,
          relativePath: tab.path,
          displayName: label,
        });
      },

      toggleBottomPanel(open: boolean) {
        const client = getTerminalDaemonClient();
        const state = useWorkspaceStore.getState();
        const project = state.selectedProject();
        const selectedWs = state.selectedWorkspace();
        if (!project || selectedWs?.status !== "ready") return;

        const projectKey = projectRuntimeKey(project.id);
        if (!open) {
          state.setProjectTerminalPanelVisible(projectKey, true);
          const runtime = state.runtimes[projectKey];
          if ((runtime?.terminalPanel?.groups.length ?? 0) === 0 && client) {
            const seeded = seedProjectTerminal(client, projectKey);
            state.addProjectTerminalGroup(projectKey, seeded.slotID);
          }
        }
      },
    }),
    []
  );
}

export function useProjectTerminalCommands() {
  const run = useRuntimeCommandRunner();

  return useMemo(
    () => ({
      addProjectTerminalGroup: (workspaceId: string, slotId: string, index?: number) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.addProjectTerminalGroup(workspaceId, slotId, index)
          )
        ),
      splitProjectTerminalGroup: (workspaceId: string, groupId: string, slotId: string) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.splitProjectTerminalGroup(workspaceId, groupId, slotId)
          )
        ),
      closeProjectTerminal: (workspaceId: string, slotId: string) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.closeProjectTerminal(workspaceId, slotId)
          )
        ),
      selectProjectTerminalGroup: (workspaceId: string, groupId: string, slotId?: string | null) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.selectProjectTerminalGroup(workspaceId, groupId, slotId)
          )
        ),
      focusProjectTerminal: (workspaceId: string, slotId: string | null) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.focusProjectTerminal(workspaceId, slotId)
          )
        ),
      setProjectTerminalPanelVisible: (workspaceId: string, visible: boolean) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.setProjectTerminalPanelVisible(workspaceId, visible)
          )
        ),
      reorderProjectTerminalGroups: (workspaceId: string, fromIndex: number, toIndex: number) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.reorderProjectTerminalGroups(workspaceId, fromIndex, toIndex)
          )
        ),
      reorderProjectTerminalGroupChildren: (
        workspaceId: string,
        groupId: string,
        fromIndex: number,
        toIndex: number
      ) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.reorderProjectTerminalGroupChildren(workspaceId, groupId, fromIndex, toIndex)
          )
        ),
      moveProjectTerminalToGroup: (
        workspaceId: string,
        slotId: string,
        targetGroupId: string,
        index?: number
      ) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.moveProjectTerminalToGroup(workspaceId, slotId, targetGroupId, index)
          )
        ),
      moveProjectTerminalToNewGroup: (workspaceId: string, slotId: string, index: number) =>
        run(
          Effect.flatMap(WorkspaceRegistry, (registry) =>
            registry.moveProjectTerminalToNewGroup(workspaceId, slotId, index)
          )
        ),
    }),
    [run]
  );
}
