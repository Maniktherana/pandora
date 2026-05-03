import type { SlotState } from "@/lib/shared/shared.types";
import { getIpcClient } from "@/lib/services/ipc/lifecycle";
import {
  getOrderedProjectTerminalSlotIds,
  getOrderedWorkspaceTerminalSlotIds,
  getVisibleProjectTerminalSlotIds,
  getVisibleWorkspaceTerminalSlotIds,
} from "@/lib/shared/terminal/lazy-connections";
import {
  seedProjectTerminal,
  seedWorkspaceTerminal,
} from "@/lib/services/terminal/seed";
import { isProjectTerminalKey, projectTerminalKey } from "@/lib/services/terminal/project-key";
import {
  addProjectTerminalGroup,
  setProjectTerminalPanelVisible,
} from "@/lib/services/terminal/project-panel";
import { useTerminalScopeStore } from "@/lib/services/terminal/store";
import { useLayoutStore } from "@/lib/services/layout/store";
import { persistProjectTerminalPanel } from "@/lib/services/preferences/project-terminal";

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
  getSelectedWorkspaceId: () => string | null;
  getSelectedProjectId: () => string | null;
  getWorkspaceRecord: (workspaceId: string) => { projectId: string } | undefined;
  scheduleTerminalStartupRefresh: () => void;
}

function getScopeSlots(scopeId: string): SlotState[] {
  return useTerminalScopeStore.getState().byScopeId[scopeId]?.slots ?? [];
}

export function createTerminalStartupService(ctx: TerminalStartupContext) {
  const pendingSessionOpens = new Set<string>();
  const hiddenWarmupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const hiddenWarmupPendingSlots = new Map<string, string>();
  const hiddenWarmupGeneration = new Map<string, number>();
  const pendingDefaultTerminalSeeds = new Set<string>();
  const pendingInitialTerminalWorkspaceIds = new Set<string>();

  function terminalStartupKey(scopeId: string, slotId: string) {
    return `${scopeId}:${slotId}`;
  }

  function selectedScopeIds(): string[] {
    const ids: string[] = [];
    const selectedWorkspaceId = ctx.getSelectedWorkspaceId();
    const selectedProjectId = ctx.getSelectedProjectId();
    if (selectedWorkspaceId) ids.push(selectedWorkspaceId);
    if (selectedProjectId) ids.push(projectTerminalKey(selectedProjectId));
    return ids;
  }

  function isScopeStartupActive(scopeId: string): boolean {
    if (isProjectTerminalKey(scopeId)) {
      const pid = ctx.getSelectedProjectId();
      return pid !== null && scopeId === projectTerminalKey(pid);
    }
    return ctx.getSelectedWorkspaceId() === scopeId;
  }

  function getScopeSlotState(scopeId: string, slotId: string): SlotState | undefined {
    return getScopeSlots(scopeId).find((slot) => slot.id === slotId);
  }

  function clearPendingSessionOpensForScope(scopeId: string) {
    for (const key of Array.from(pendingSessionOpens)) {
      if (key.startsWith(`${scopeId}:`)) pendingSessionOpens.delete(key);
    }
  }

  function reconcilePendingSessionOpens(scopeId: string) {
    for (const key of Array.from(pendingSessionOpens)) {
      if (!key.startsWith(`${scopeId}:`)) continue;
      const slotId = key.slice(scopeId.length + 1);
      if (!shouldAutoOpenTerminalSlot(getScopeSlotState(scopeId, slotId))) {
        pendingSessionOpens.delete(key);
      }
    }
  }

  function reconcileHiddenWarmupPendingSlot(scopeId: string) {
    const pendingSlotId = hiddenWarmupPendingSlots.get(scopeId);
    if (!pendingSlotId) return;
    if (!shouldAutoOpenTerminalSlot(getScopeSlotState(scopeId, pendingSlotId))) {
      hiddenWarmupPendingSlots.delete(scopeId);
    }
  }

  function cancelHiddenWarmup(scopeId: string) {
    hiddenWarmupGeneration.set(scopeId, (hiddenWarmupGeneration.get(scopeId) ?? 0) + 1);
    hiddenWarmupPendingSlots.delete(scopeId);
    const timer = hiddenWarmupTimers.get(scopeId);
    if (timer != null) {
      hiddenWarmupTimers.delete(scopeId);
      clearTimeout(timer);
    }
  }

  function getVisibleScopeTerminalSlotIds(scopeId: string): string[] {
    if (!isScopeStartupActive(scopeId)) return [];
    const scopeState = useTerminalScopeStore.getState().byScopeId[scopeId];
    return isProjectTerminalKey(scopeId)
      ? getVisibleProjectTerminalSlotIds(scopeState?.terminalPanel ?? null)
      : getVisibleWorkspaceTerminalSlotIds(
          useLayoutStore.getState().byWorkspaceId[scopeId]?.root ?? null,
        );
  }

  function getOrderedScopeTerminalSlotIds(scopeId: string): string[] {
    if (!isScopeStartupActive(scopeId)) return [];
    const scopeState = useTerminalScopeStore.getState().byScopeId[scopeId];
    return isProjectTerminalKey(scopeId)
      ? getOrderedProjectTerminalSlotIds(scopeState?.terminalPanel ?? null)
      : getOrderedWorkspaceTerminalSlotIds(
          useLayoutStore.getState().byWorkspaceId[scopeId]?.root ?? null,
        );
  }

  async function ensureTerminalSlotSession(scopeId: string, slotId: string): Promise<boolean> {
    reconcilePendingSessionOpens(scopeId);
    const slots = getScopeSlots(scopeId);
    const slot = slots.find((candidate) => candidate.id === slotId);
    if (!shouldAutoOpenTerminalSlot(slot)) return false;
    if (!slot) return false;

    const requestKey = terminalStartupKey(scopeId, slotId);
    if (pendingSessionOpens.has(requestKey)) return false;

    const sessionDefID = slot.sessionDefIDs[0];
    if (!sessionDefID) return false;

    pendingSessionOpens.add(requestKey);
    const client = getIpcClient();
    if (!client) {
      pendingSessionOpens.delete(requestKey);
      return false;
    }

    try {
      await client.send(scopeId, { type: "open_session_instance", sessionDefID });
    } catch (err) {
      pendingSessionOpens.delete(requestKey);
      console.warn(`Failed to open session for scope ${scopeId} slot ${slotId}:`, err);
      return false;
    }
    return true;
  }

  async function ensureVisibleTerminalSessions(scopeId: string): Promise<void> {
    await Promise.all(
      [...new Set(getVisibleScopeTerminalSlotIds(scopeId))].map((slotId) =>
        ensureTerminalSlotSession(scopeId, slotId),
      ),
    );
  }

  async function scheduleHiddenWarmup(scopeId: string): Promise<void> {
    if (!isScopeStartupActive(scopeId)) {
      cancelHiddenWarmup(scopeId);
      return;
    }

    reconcilePendingSessionOpens(scopeId);
    reconcileHiddenWarmupPendingSlot(scopeId);

    if (hiddenWarmupTimers.has(scopeId) || hiddenWarmupPendingSlots.has(scopeId)) return;

    const visibleSlotIds = [...new Set(getVisibleScopeTerminalSlotIds(scopeId))];
    const slots = getScopeSlots(scopeId);
    if (
      visibleSlotIds.some((slotId) =>
        shouldAutoOpenTerminalSlot(slots.find((slot) => slot.id === slotId)),
      )
    ) {
      return;
    }

    const visibleSlotIdSet = new Set(visibleSlotIds);
    const hiddenSlotId = getOrderedScopeTerminalSlotIds(scopeId).find(
      (slotId) =>
        !visibleSlotIdSet.has(slotId) &&
        shouldAutoOpenTerminalSlot(slots.find((slot) => slot.id === slotId)),
    );
    if (!hiddenSlotId) return;

    const generation = hiddenWarmupGeneration.get(scopeId) ?? 0;
    const timer = setTimeout(() => {
      hiddenWarmupTimers.delete(scopeId);
      reconcilePendingSessionOpens(scopeId);
      reconcileHiddenWarmupPendingSlot(scopeId);
      if ((hiddenWarmupGeneration.get(scopeId) ?? 0) !== generation) return;
      if (!isScopeStartupActive(scopeId)) return;
      ensureTerminalSlotSession(scopeId, hiddenSlotId)
        .then((opened) => {
          if (opened) hiddenWarmupPendingSlots.set(scopeId, hiddenSlotId);
        })
        .catch((err) => console.warn("Hidden warmup session open failed:", err));
    }, HIDDEN_WARMUP_DELAY_MS);
    hiddenWarmupTimers.set(scopeId, timer);
  }

  async function refreshScopeTerminalStartup(
    scopeId: string,
    options?: { rebuildHiddenQueue?: boolean },
  ): Promise<void> {
    if (options?.rebuildHiddenQueue) cancelHiddenWarmup(scopeId);

    if (!isScopeStartupActive(scopeId)) {
      cancelHiddenWarmup(scopeId);
      return;
    }

    reconcilePendingSessionOpens(scopeId);
    reconcileHiddenWarmupPendingSlot(scopeId);
    await ensureVisibleTerminalSessions(scopeId);
    await scheduleHiddenWarmup(scopeId);
  }

  async function refreshActiveScopeTerminalStartup(options?: {
    rebuildHiddenQueues?: boolean;
  }): Promise<void> {
    const activeScopeIds = selectedScopeIds();
    const activeScopeIdSet = new Set(activeScopeIds);

    for (const scopeId of new Set([
      ...hiddenWarmupTimers.keys(),
      ...hiddenWarmupPendingSlots.keys(),
    ])) {
      if (!activeScopeIdSet.has(scopeId)) cancelHiddenWarmup(scopeId);
    }

    await Promise.all(
      activeScopeIds.map((scopeId) =>
        refreshScopeTerminalStartup(scopeId, {
          rebuildHiddenQueue: options?.rebuildHiddenQueues === true,
        }),
      ),
    );
  }

  function clearScopeTerminalStartupTracking(scopeId: string) {
    cancelHiddenWarmup(scopeId);
    clearPendingSessionOpensForScope(scopeId);
    hiddenWarmupPendingSlots.delete(scopeId);
    hiddenWarmupGeneration.delete(scopeId);
  }

  function markPendingInitialTerminal(workspaceId: string) {
    pendingInitialTerminalWorkspaceIds.add(workspaceId);
  }

  function cleanupAllowedScopeIds(allowedScopeIds: Set<string>) {
    for (const workspaceId of pendingInitialTerminalWorkspaceIds) {
      if (!allowedScopeIds.has(workspaceId))
        pendingInitialTerminalWorkspaceIds.delete(workspaceId);
    }
  }

  function ensureWorkspaceDefaultTerminal(
    workspaceId: string,
    onSeeded: (slotId: string) => void,
  ): void {
    if (isProjectTerminalKey(workspaceId)) return;
    if (!pendingInitialTerminalWorkspaceIds.has(workspaceId)) return;
    const slots = getScopeSlots(workspaceId);
    const layoutState = useLayoutStore.getState().byWorkspaceId[workspaceId];
    if (layoutState?.layoutLoading) return;
    if (slots.some((s) => s.kind === "terminal_slot")) {
      pendingInitialTerminalWorkspaceIds.delete(workspaceId);
      return;
    }
    if (pendingDefaultTerminalSeeds.has(workspaceId)) return;
    pendingDefaultTerminalSeeds.add(workspaceId);

    (async () => {
      try {
        const alreadySeeded = getScopeSlots(workspaceId).some(
          (slot) => slot.kind === "terminal_slot",
        );
        if (alreadySeeded) {
          pendingInitialTerminalWorkspaceIds.delete(workspaceId);
          return;
        }

        const client = getIpcClient();
        if (!client) return;

        const seeded = await seedWorkspaceTerminal(client, workspaceId);
        onSeeded(seeded.slotID);

        const workspaceRecord = ctx.getWorkspaceRecord(workspaceId);
        if (workspaceRecord) {
          const projectScopeId = projectTerminalKey(workspaceRecord.projectId);
          const projectPanel = useTerminalScopeStore.getState().byScopeId[projectScopeId]?.terminalPanel;
          if ((projectPanel?.groups.length ?? 0) === 0) {
            try {
              const seededProj = await seedProjectTerminal(client, projectScopeId);
              addProjectTerminalGroup(projectScopeId, seededProj.slotID);
              setProjectTerminalPanelVisible(projectScopeId, true);
              const panel = useTerminalScopeStore.getState().byScopeId[projectScopeId]?.terminalPanel ?? null;
              persistProjectTerminalPanel(projectScopeId, panel).catch((err) =>
                console.warn("Failed to persist project terminal panel after seed:", err),
              );
              refreshScopeTerminalStartup(projectScopeId, { rebuildHiddenQueue: true }).catch(
                (err) => console.warn("Failed to refresh project scope terminal startup:", err),
              );
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
    })().catch((err) => console.warn("ensureWorkspaceDefaultTerminal async error:", err));
  }

  return {
    refreshScopeTerminalStartup,
    refreshActiveScopeTerminalStartup,
    clearScopeTerminalStartupTracking,
    ensureWorkspaceDefaultTerminal,
    markPendingInitialTerminal,
    cleanupAllowedScopeIds,
    cancelHiddenWarmup,
  };
}
