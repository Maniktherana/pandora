import { Context, Effect, Layer } from "effect";
import { findLeaf } from "@/components/layout/workspace/layout-migrate";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { tryCloseEditorTab } from "@/components/editor/close-dirty-editor";
import { DesktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";
import { DaemonGateway } from "@/services/daemon/daemon-gateway";
import { seedProjectTerminal, seedWorkspaceTerminal } from "@/lib/terminal/terminal-seed";
import { TerminalCommandError } from "@/services/service-errors";
import { TerminalSurfaceService } from "@/services/terminal/terminal-surface-service";

export interface TerminalCommandServiceApi {
  readonly newTerminal: () => Effect.Effect<void, TerminalCommandError>;
  readonly createWorkspaceTerminal: (
    runtimeId: string,
  ) => Effect.Effect<void, TerminalCommandError>;
  readonly createProjectTerminal: (
    runtimeId: string,
    index?: number,
  ) => Effect.Effect<void, TerminalCommandError>;
  readonly splitProjectTerminalGroup: (
    runtimeId: string,
    groupId: string,
  ) => Effect.Effect<void, TerminalCommandError>;
  readonly closeTerminalSlot: (
    runtimeId: string,
    slotId: string,
  ) => Effect.Effect<void, TerminalCommandError>;
  readonly renameTerminal: (
    runtimeId: string,
    slotId: string,
    name: string,
  ) => Effect.Effect<void, TerminalCommandError>;
  readonly sendInput: (
    runtimeId: string,
    sessionId: string,
    text: string,
  ) => Effect.Effect<void, TerminalCommandError>;
  readonly closeFocusedTab: () => Effect.Effect<void, TerminalCommandError>;
  readonly toggleBottomPanel: (currentlyOpen: boolean) => Effect.Effect<void, TerminalCommandError>;
}

export class TerminalCommandService extends Context.Tag("pandora/TerminalCommandService")<
  TerminalCommandService,
  TerminalCommandServiceApi
>() {}

export function encodeTerminalInput(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary);
}

export function resolveNewTerminalRuntimeId(state: {
  effectiveLayoutRuntimeId: () => string | null;
  selectedWorkspaceID: string | null;
}) {
  return state.effectiveLayoutRuntimeId() ?? state.selectedWorkspaceID;
}

export const TerminalCommandServiceLive = Layer.scoped(
  TerminalCommandService,
  Effect.gen(function* () {
    const daemonGateway = yield* DaemonGateway;
    const workspaceService = yield* DesktopWorkspaceService;
    const terminalSurfaceService = yield* TerminalSurfaceService;

    const getClient = (runtimeId?: string) =>
      Effect.flatMap(daemonGateway.getClient(), (client) =>
        client
          ? Effect.succeed(client)
          : Effect.fail(
              new TerminalCommandError({
                cause: new Error("Terminal daemon not connected"),
                runtimeId,
              }),
            ),
      );

    const createProjectTerminal = (runtimeId: string, index?: number) =>
      Effect.gen(function* () {
        const client = yield* getClient(runtimeId);
        const seeded = yield* Effect.tryPromise({
          try: () => seedProjectTerminal(client, runtimeId),
          catch: (cause) => new TerminalCommandError({ cause, runtimeId }),
        });
        yield* workspaceService.addProjectTerminalGroup(runtimeId, seeded.slotID, index);
        yield* workspaceService.setProjectTerminalPanelVisible(runtimeId, true);
      });

    const closeTerminalSlot = (runtimeId: string, slotId: string) =>
      Effect.gen(function* () {
        const runtime = yield* workspaceService.getRuntimeState(runtimeId);
        const slot = yield* workspaceService.getSlotState(runtimeId, slotId);
        const sessionIds = new Set<string>(slot?.sessionIDs ?? []);
        for (const session of runtime?.sessions ?? []) {
          if (session.slotID === slotId) {
            sessionIds.add(session.id);
          }
        }

        const client = yield* getClient(runtimeId);
        yield* client
          .sendEffect(runtimeId, { type: "remove_slot", slotID: slotId })
          .pipe(Effect.mapError((cause) => new TerminalCommandError({ cause, runtimeId })));
        for (const sessionId of sessionIds) {
          yield* terminalSurfaceService.removeSurface(sessionId).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                console.warn("Failed to remove terminal surface after slot close:", error);
              }),
            ),
          );
        }
        if (isProjectRuntimeKey(runtimeId)) {
          yield* workspaceService.closeProjectTerminal(runtimeId, slotId);
        }
      });

    return {
      newTerminal: () =>
        Effect.gen(function* () {
          const effectiveLayoutRuntimeId = yield* workspaceService.getEffectiveLayoutRuntimeId();
          const selectedWorkspaceId = yield* workspaceService.getSelectedWorkspaceId();
          const runtimeId = resolveNewTerminalRuntimeId({
            effectiveLayoutRuntimeId: () => effectiveLayoutRuntimeId,
            selectedWorkspaceID: selectedWorkspaceId,
          });
          if (!runtimeId) return;
          if (isProjectRuntimeKey(runtimeId)) {
            yield* createProjectTerminal(runtimeId);
            return;
          }
          yield* workspaceService.ensureWorkspaceRuntimeConnected(runtimeId);
          yield* Effect.flatMap(getClient(runtimeId), (client) =>
            Effect.gen(function* () {
              const seeded = yield* Effect.tryPromise({
                try: () => seedWorkspaceTerminal(client, runtimeId),
                catch: (cause) => new TerminalCommandError({ cause, runtimeId }),
              });
              const session = yield* workspaceService.getWorkspaceSession(runtimeId);
              yield* session.commands.addTerminalTab(seeded.slotID);
            }),
          );
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof TerminalCommandError ? cause : new TerminalCommandError({ cause }),
          ),
        ),

      createWorkspaceTerminal: (runtimeId) =>
        Effect.gen(function* () {
          yield* workspaceService.ensureWorkspaceRuntimeConnected(runtimeId);
          const client = yield* getClient(runtimeId);
          yield* Effect.gen(function* () {
            const seeded = yield* Effect.tryPromise({
              try: () => seedWorkspaceTerminal(client, runtimeId),
              catch: (cause) => new TerminalCommandError({ cause, runtimeId }),
            });
            const session = yield* workspaceService.getWorkspaceSession(runtimeId);
            yield* session.commands.addTerminalTab(seeded.slotID);
          });
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof TerminalCommandError
              ? cause
              : new TerminalCommandError({ cause, runtimeId }),
          ),
        ),
      createProjectTerminal,

      splitProjectTerminalGroup: (runtimeId, groupId) =>
        Effect.gen(function* () {
          const client = yield* getClient(runtimeId);
          const seeded = yield* Effect.tryPromise({
            try: () => seedProjectTerminal(client, runtimeId),
            catch: (cause) => new TerminalCommandError({ cause, runtimeId }),
          });
          yield* workspaceService.splitProjectTerminalGroup(runtimeId, groupId, seeded.slotID);
          yield* workspaceService.setProjectTerminalPanelVisible(runtimeId, true);
        }),

      closeTerminalSlot,

      renameTerminal: (runtimeId, slotId, name) =>
        Effect.gen(function* () {
          const client = yield* getClient(runtimeId);

          yield* client
            .sendEffect(runtimeId, {
              type: "update_slot",
              slot: { id: slotId, name },
            })
            .pipe(Effect.mapError((cause) => new TerminalCommandError({ cause, runtimeId })));
        }),

      sendInput: (runtimeId, sessionId, text) =>
        Effect.flatMap(getClient(runtimeId), (client) =>
          client
            .sendEffect(runtimeId, {
              type: "input",
              sessionID: sessionId,
              data: encodeTerminalInput(text),
            })
            .pipe(Effect.mapError((cause) => new TerminalCommandError({ cause, runtimeId }))),
        ),

      closeFocusedTab: () =>
        Effect.gen(function* () {
          const runtimeId = yield* workspaceService.getEffectiveLayoutRuntimeId();
          if (!runtimeId) return;

          const runtime = yield* workspaceService.getRuntimeState(runtimeId);
          if (!runtime) return;

          if (isProjectRuntimeKey(runtimeId)) {
            const slotId = runtime.terminalPanel?.activeSlotId;
            if (!slotId) return;
            yield* closeTerminalSlot(runtimeId, slotId);
            return;
          }

          const focusedPaneID = runtime.focusedPaneID;
          if (!runtime.root || !focusedPaneID) return;
          const leaf = findLeaf(runtime.root, focusedPaneID);
          if (!leaf || leaf.tabs.length === 0) return;

          const index = leaf.selectedIndex;
          const tab = leaf.tabs[index] ?? leaf.tabs[0];
          if (!tab) return;

          if (tab.kind === "terminal") {
            yield* closeTerminalSlot(runtimeId, tab.slotId);
            return;
          }

          if (tab.kind === "diff" || tab.kind === "review") {
            const session = yield* workspaceService.getWorkspaceSession(runtimeId);
            yield* session.commands.closeTab(focusedPaneID, index);
            return;
          }

          const workspace = yield* workspaceService.getWorkspaceRecord(runtimeId);
          if (!workspace || workspace.status !== "ready") return;

          const label = tab.path.split("/").pop() ?? tab.path;
          const session = yield* workspaceService.getWorkspaceSession(runtimeId);
          yield* Effect.tryPromise({
            try: async () =>
              tryCloseEditorTab({
                workspaceId: workspace.id,
                workspaceRoot: workspace.worktreePath,
                paneID: focusedPaneID,
                tabIndex: index,
                relativePath: tab.path,
                displayName: label,
                closeTab: (paneID, tabIndex) =>
                  Effect.runPromise(session.commands.closeTab(paneID, tabIndex)),
              }),
            catch: (cause) => new TerminalCommandError({ cause, runtimeId }),
          });
        }).pipe(
          Effect.mapError((cause) =>
            cause instanceof TerminalCommandError ? cause : new TerminalCommandError({ cause }),
          ),
        ),

      toggleBottomPanel: (currentlyOpen) =>
        Effect.gen(function* () {
          if (currentlyOpen) return;

          const selectedProjectId = yield* workspaceService.getSelectedProjectId();
          const selectedWorkspaceId = yield* workspaceService.getSelectedWorkspaceId();
          const selectedWorkspace = selectedWorkspaceId
            ? yield* workspaceService.getWorkspaceRecord(selectedWorkspaceId)
            : null;
          if (!selectedProjectId || selectedWorkspace?.status !== "ready") return;

          const runtimeId = projectRuntimeKey(selectedProjectId);
          yield* workspaceService.setProjectTerminalPanelVisible(runtimeId, true);

          const runtime = yield* workspaceService.getRuntimeState(runtimeId);
          if ((runtime?.terminalPanel?.groups.length ?? 0) > 0) return;

          yield* createProjectTerminal(runtimeId);
        }),
    } satisfies TerminalCommandServiceApi;
  }),
);
