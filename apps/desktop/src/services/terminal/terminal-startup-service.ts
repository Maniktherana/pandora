import type { WritableDraft } from "immer";
import type { SlotState, WorkspaceRuntimeState } from "@/lib/shared/types";
import { runtimeGateway } from "@/services/runtime/runtime-gateway";
import {
  getOrderedProjectTerminalSlotIds,
  getOrderedWorkspaceTerminalSlotIds,
  getVisibleProjectTerminalSlotIds,
  getVisibleWorkspaceTerminalSlotIds,
} from "@/lib/terminal/lazy-terminal-connections";
import {
  seedProjectTerminal,
  seedWorkspaceTerminal,
} from "@/lib/terminal/terminal-seed";
import { isProjectRuntimeKey, projectRuntimeKey } from "@/lib/runtime/runtime-keys";
import { addProjectTerminalGroupInRuntime, setProjectTerminalPanelVisibleInRuntime } from "@/services/terminal/project-terminal-panel-model";

export const HIDDEN_WARMUP_DELAY_MS = 120;

export function shouldAutoOpenTerminalSlot(slot: SlotState | undefined): boolean {
  return Boolean(
    slot &&
      slot.kind === "terminal_slot" &&
      slot.sessionIDs.length === 0 &&
      slot.sessionDefIDs.length > 0,
  );
}

export interface TerminalStartupContext {
  getRuntimes: () => Record<string, WorkspaceRuntimeState>;
  getSelectedWorkspaceId: () => string | null;
  getSelectedProjectId: () => string | null;
  getWorkspaceRecord: (workspaceId: string) => { projectId: string } | undefined;
  mutateRuntimeState: <T>(
    runtimeId: string,
    mutate: (runtime: WritableDraft<WorkspaceRuntimeState>) => T,
  ) => T;
  scheduleTerminalStartupRefresh: () => void;
}

export function createTerminalStartupService(ctx: TerminalStartupContext) {
  const pendingSessionOpens = new Set<string>();
  const hiddenWarmupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const hiddenWarmupPendingSlots = new Map<string, string>();
  const hiddenWarmupGeneration = new Map<string, number>();
  const pendingDefaultTerminalSeeds = new Set<string>();
  const pendingInitialTerminalWorkspaceIds = new Set<string>();

  function terminalStartupKey(runtimeId: string, slotId: string) {
    return `${runtimeId}:${slotId}`;
  }

  function selectedRuntimeIds(): string[] {
    const ids: string[] = [];
    const selectedWorkspaceId = ctx.getSelectedWorkspaceId();
    const selectedProjectId = ctx.getSelectedProjectId();
    if (selectedWorkspaceId) ids.push(selectedWorkspaceId);
    if (selectedProjectId) ids.push(projectRuntimeKey(selectedProjectId));
    return ids;
  }

  function isRuntimeStartupActive(runtimeId: string): boolean {
    if (isProjectRuntimeKey(runtimeId)) {
      const pid = ctx.getSelectedProjectId();
      return pid !== null && runtimeId === projectRuntimeKey(pid);
    }
    return ctx.getSelectedWorkspaceId() === runtimeId;
  }

  function getRuntimeSlotState(runtimeId: string, slotId: string): SlotState | undefined {
    return ctx.getRuntimes()[runtimeId]?.slots.find((slot) => slot.id === slotId);
  }

  function clearPendingSessionOpensForRuntime(runtimeId: string) {
    for (const key of Array.from(pendingSessionOpens)) {
      if (key.startsWith(`${runtimeId}:`)) pendingSessionOpens.delete(key);
    }
  }

  function reconcilePendingSessionOpens(runtimeId: string) {
    for (const key of Array.from(pendingSessionOpens)) {
      if (!key.startsWith(`${runtimeId}:`)) continue;
      const slotId = key.slice(runtimeId.length + 1);
      if (!shouldAutoOpenTerminalSlot(getRuntimeSlotState(runtimeId, slotId))) {
        pendingSessionOpens.delete(key);
      }
    }
  }

  function reconcileHiddenWarmupPendingSlot(runtimeId: string) {
    const pendingSlotId = hiddenWarmupPendingSlots.get(runtimeId);
    if (!pendingSlotId) return;
    if (!shouldAutoOpenTerminalSlot(getRuntimeSlotState(runtimeId, pendingSlotId))) {
      hiddenWarmupPendingSlots.delete(runtimeId);
    }
  }

  function cancelHiddenWarmup(runtimeId: string) {
    hiddenWarmupGeneration.set(runtimeId, (hiddenWarmupGeneration.get(runtimeId) ?? 0) + 1);
    hiddenWarmupPendingSlots.delete(runtimeId);
    const timer = hiddenWarmupTimers.get(runtimeId);
    if (timer != null) {
      hiddenWarmupTimers.delete(runtimeId);
      clearTimeout(timer);
    }
  }

  function getVisibleRuntimeTerminalSlotIds(runtimeId: string): string[] {
    if (!isRuntimeStartupActive(runtimeId)) return [];
    const runtime = ctx.getRuntimes()[runtimeId];
    if (!runtime || runtime.connectionState !== "connected") return [];
    return isProjectRuntimeKey(runtimeId)
      ? getVisibleProjectTerminalSlotIds(runtime.terminalPanel)
      : getVisibleWorkspaceTerminalSlotIds(runtime.root);
  }

  function getOrderedRuntimeTerminalSlotIds(runtimeId: string): string[] {
    if (!isRuntimeStartupActive(runtimeId)) return [];
    const runtime = ctx.getRuntimes()[runtimeId];
    if (!runtime || runtime.connectionState !== "connected") return [];
    return isProjectRuntimeKey(runtimeId)
      ? getOrderedProjectTerminalSlotIds(runtime.terminalPanel)
      : getOrderedWorkspaceTerminalSlotIds(runtime.root);
  }

  async function ensureTerminalSlotSession(runtimeId: string, slotId: string): Promise<boolean> {
    const runtime = ctx.getRuntimes()[runtimeId];
    if (!runtime || runtime.connectionState !== "connected") return false;

    reconcilePendingSessionOpens(runtimeId);
    const slot = runtime.slots.find((candidate) => candidate.id === slotId);
    if (!shouldAutoOpenTerminalSlot(slot)) return false;
    if (!slot) return false;

    const requestKey = terminalStartupKey(runtimeId, slotId);
    if (pendingSessionOpens.has(requestKey)) return false;

    const sessionDefID = slot.sessionDefIDs[0];
    if (!sessionDefID) return false;

    pendingSessionOpens.add(requestKey);
    const client = runtimeGateway.getClient();
    if (!client) {
      pendingSessionOpens.delete(requestKey);
      return false;
    }

    await client.send(runtimeId, { type: "open_session_instance", sessionDefID });
    return true;
  }

  async function ensureVisibleTerminalSessions(runtimeId: string): Promise<void> {
    await Promise.all(
      [...new Set(getVisibleRuntimeTerminalSlotIds(runtimeId))].map((slotId) =>
        ensureTerminalSlotSession(runtimeId, slotId),
      ),
    );
  }

  async function scheduleHiddenWarmup(runtimeId: string): Promise<void> {
    const runtime = ctx.getRuntimes()[runtimeId];
    if (
      !runtime ||
      runtime.connectionState !== "connected" ||
      !isRuntimeStartupActive(runtimeId)
    ) {
      cancelHiddenWarmup(runtimeId);
      return;
    }

    reconcilePendingSessionOpens(runtimeId);
    reconcileHiddenWarmupPendingSlot(runtimeId);

    if (hiddenWarmupTimers.has(runtimeId) || hiddenWarmupPendingSlots.has(runtimeId)) return;

    const visibleSlotIds = [...new Set(getVisibleRuntimeTerminalSlotIds(runtimeId))];
    if (
      visibleSlotIds.some((slotId) =>
        shouldAutoOpenTerminalSlot(runtime.slots.find((slot) => slot.id === slotId)),
      )
    ) {
      return;
    }

    const visibleSlotIdSet = new Set(visibleSlotIds);
    const hiddenSlotId = getOrderedRuntimeTerminalSlotIds(runtimeId).find(
      (slotId) =>
        !visibleSlotIdSet.has(slotId) &&
        shouldAutoOpenTerminalSlot(runtime.slots.find((slot) => slot.id === slotId)),
    );
    if (!hiddenSlotId) return;

    const generation = hiddenWarmupGeneration.get(runtimeId) ?? 0;
    const timer = setTimeout(() => {
      hiddenWarmupTimers.delete(runtimeId);
      reconcilePendingSessionOpens(runtimeId);
      reconcileHiddenWarmupPendingSlot(runtimeId);
      if ((hiddenWarmupGeneration.get(runtimeId) ?? 0) !== generation) return;
      if (!isRuntimeStartupActive(runtimeId)) return;
      void ensureTerminalSlotSession(runtimeId, hiddenSlotId).then((opened) => {
        if (opened) hiddenWarmupPendingSlots.set(runtimeId, hiddenSlotId);
      });
    }, HIDDEN_WARMUP_DELAY_MS);
    hiddenWarmupTimers.set(runtimeId, timer);
  }

  async function refreshRuntimeTerminalStartup(
    runtimeId: string,
    options?: { rebuildHiddenQueue?: boolean },
  ): Promise<void> {
    const runtime = ctx.getRuntimes()[runtimeId];
    if (options?.rebuildHiddenQueue) cancelHiddenWarmup(runtimeId);

    if (
      !runtime ||
      runtime.connectionState !== "connected" ||
      !isRuntimeStartupActive(runtimeId)
    ) {
      if (!runtime || runtime.connectionState !== "connected") {
        clearPendingSessionOpensForRuntime(runtimeId);
      }
      cancelHiddenWarmup(runtimeId);
      return;
    }

    reconcilePendingSessionOpens(runtimeId);
    reconcileHiddenWarmupPendingSlot(runtimeId);
    await ensureVisibleTerminalSessions(runtimeId);
    await scheduleHiddenWarmup(runtimeId);
  }

  async function refreshActiveRuntimeTerminalStartup(options?: {
    rebuildHiddenQueues?: boolean;
  }): Promise<void> {
    const activeRuntimeIds = selectedRuntimeIds();
    const activeRuntimeIdSet = new Set(activeRuntimeIds);

    for (const runtimeId of new Set([
      ...hiddenWarmupTimers.keys(),
      ...hiddenWarmupPendingSlots.keys(),
    ])) {
      if (!activeRuntimeIdSet.has(runtimeId)) cancelHiddenWarmup(runtimeId);
    }

    await Promise.all(
      activeRuntimeIds.map((runtimeId) =>
        refreshRuntimeTerminalStartup(runtimeId, {
          rebuildHiddenQueue: options?.rebuildHiddenQueues === true,
        }),
      ),
    );
  }

  function clearRuntimeTerminalStartupTracking(runtimeId: string) {
    cancelHiddenWarmup(runtimeId);
    clearPendingSessionOpensForRuntime(runtimeId);
    hiddenWarmupPendingSlots.delete(runtimeId);
    hiddenWarmupGeneration.delete(runtimeId);
  }

  function markPendingInitialTerminal(workspaceId: string) {
    pendingInitialTerminalWorkspaceIds.add(workspaceId);
  }

  function cleanupAllowedRuntimeIds(allowedRuntimeIds: Set<string>) {
    for (const workspaceId of pendingInitialTerminalWorkspaceIds) {
      if (!allowedRuntimeIds.has(workspaceId))
        pendingInitialTerminalWorkspaceIds.delete(workspaceId);
    }
  }

  function ensureWorkspaceDefaultTerminal(
    workspaceId: string,
    onSeeded: (slotId: string) => void,
  ): void {
    if (isProjectRuntimeKey(workspaceId)) return;
    if (!pendingInitialTerminalWorkspaceIds.has(workspaceId)) return;
    const runtime = ctx.getRuntimes()[workspaceId];
    if (!runtime) return;
    if (runtime.layoutLoading) return;
    if (runtime.connectionState !== "connected") return;
    if (runtime.slots.some((s) => s.kind === "terminal_slot")) {
      pendingInitialTerminalWorkspaceIds.delete(workspaceId);
      return;
    }
    if (pendingDefaultTerminalSeeds.has(workspaceId)) return;
    pendingDefaultTerminalSeeds.add(workspaceId);

    void (async () => {
      try {
        const alreadySeeded =
          (ctx.getRuntimes()[workspaceId]?.slots.some((slot) => slot.kind === "terminal_slot") ??
            false);
        if (alreadySeeded) {
          pendingInitialTerminalWorkspaceIds.delete(workspaceId);
          return;
        }

        const client = runtimeGateway.getClient();
        if (!client) return;

        const seeded = await seedWorkspaceTerminal(client, workspaceId);
        onSeeded(seeded.slotID);

        const workspaceRecord = ctx.getWorkspaceRecord(workspaceId);
        if (workspaceRecord) {
          const projectRuntimeId = projectRuntimeKey(workspaceRecord.projectId);
          await waitForRuntimeConnected(projectRuntimeId, 10_000, ctx.getRuntimes);
          const projRuntime = ctx.getRuntimes()[projectRuntimeId];
          if (projRuntime && (projRuntime.terminalPanel?.groups.length ?? 0) === 0) {
            try {
              const seededProj = await seedProjectTerminal(client, projectRuntimeId);
              ctx.mutateRuntimeState(projectRuntimeId, (runtime) => {
                addProjectTerminalGroupInRuntime(runtime, seededProj.slotID);
                setProjectTerminalPanelVisibleInRuntime(runtime, true);
              });
              void refreshRuntimeTerminalStartup(projectRuntimeId, { rebuildHiddenQueue: true });
            } catch (err) {
              console.warn("Failed to seed default project bottom terminal:", err);
            }
          }
        }

        pendingInitialTerminalWorkspaceIds.delete(workspaceId);
      } catch (error) {
        console.warn("Failed to seed default workspace terminal:", error);
      } finally {
        pendingDefaultTerminalSeeds.delete(workspaceId);
      }
    })();
  }

  return {
    refreshRuntimeTerminalStartup,
    refreshActiveRuntimeTerminalStartup,
    clearRuntimeTerminalStartupTracking,
    ensureWorkspaceDefaultTerminal,
    markPendingInitialTerminal,
    cleanupAllowedRuntimeIds,
    cancelHiddenWarmup,
  };
}

/** Wait up to `timeoutMs` for a runtime to become connected. Resolves when connected, rejects on timeout. */
export function waitForRuntimeConnected(
  runtimeId: string,
  timeoutMs: number,
  getRuntimes: () => Record<string, WorkspaceRuntimeState> = () => ({}),
): Promise<void> {
  if (getRuntimes()[runtimeId]?.connectionState === "connected") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (getRuntimes()[runtimeId]?.connectionState === "connected") {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error(`Runtime ${runtimeId} did not connect within ${timeoutMs}ms`));
        return;
      }
      setTimeout(poll, 50);
    };
    setTimeout(poll, 50);
  });
}
