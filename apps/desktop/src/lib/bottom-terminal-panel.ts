import type { TerminalPanelGroup, TerminalPanelState } from "./types";

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

function normalizePanel(panel: TerminalPanelState): TerminalPanelState {
  const groups = panel.groups.filter((group) => group.children.length > 0);
  const activeGroupIndex = clampIndex(panel.activeGroupIndex, groups.length);
  const activeGroup = groups[activeGroupIndex] ?? null;
  const activeSlotId =
    activeGroup && panel.activeSlotId && activeGroup.children.includes(panel.activeSlotId)
      ? panel.activeSlotId
      : (activeGroup?.children[0] ?? null);

  return {
    groups,
    activeGroupIndex,
    activeSlotId,
    visible: panel.visible && groups.length > 0,
  };
}

export function createEmptyTerminalPanel(): TerminalPanelState {
  return {
    groups: [],
    activeGroupIndex: 0,
    activeSlotId: null,
    visible: false,
  };
}

export function terminalPanelContainsSlot(
  panel: TerminalPanelState | null | undefined,
  slotId: string
): boolean {
  return panel?.groups.some((group) => group.children.includes(slotId)) ?? false;
}

export function findTerminalGroupBySlot(
  panel: TerminalPanelState | null | undefined,
  slotId: string
): { group: TerminalPanelGroup; groupIndex: number; slotIndex: number } | null {
  if (!panel) return null;
  for (const [groupIndex, group] of panel.groups.entries()) {
    const slotIndex = group.children.indexOf(slotId);
    if (slotIndex >= 0) {
      return { group, groupIndex, slotIndex };
    }
  }
  return null;
}

export function addTerminalGroup(
  panel: TerminalPanelState | null | undefined,
  slotId: string,
  options?: {
    groupId?: string;
    index?: number;
    activate?: boolean;
  }
): TerminalPanelState {
  const base = panel ?? createEmptyTerminalPanel();
  if (terminalPanelContainsSlot(base, slotId)) {
    return base;
  }

  const nextGroups = [...base.groups];
  const nextGroup: TerminalPanelGroup = {
    id: options?.groupId ?? crypto.randomUUID(),
    children: [slotId],
  };
  const insertIndex = clampIndex(options?.index ?? nextGroups.length, nextGroups.length + 1);
  nextGroups.splice(insertIndex, 0, nextGroup);

  return normalizePanel({
    ...base,
    groups: nextGroups,
    activeGroupIndex: options?.activate === false ? base.activeGroupIndex : insertIndex,
    activeSlotId: options?.activate === false ? base.activeSlotId : slotId,
    visible: true,
  });
}

export function addTerminalToGroup(
  panel: TerminalPanelState | null | undefined,
  groupId: string,
  slotId: string,
  options?: {
    index?: number;
    activate?: boolean;
  }
): TerminalPanelState {
  const base = panel ?? createEmptyTerminalPanel();
  if (terminalPanelContainsSlot(base, slotId)) {
    return base;
  }

  const nextGroups = base.groups.map((group) => {
    if (group.id !== groupId) return group;
    const children = [...group.children];
    const insertIndex = clampIndex(options?.index ?? children.length, children.length + 1);
    children.splice(insertIndex, 0, slotId);
    return { ...group, children };
  });
  const nextGroupIndex = nextGroups.findIndex((group) => group.id === groupId);
  if (nextGroupIndex < 0) return base;

  return normalizePanel({
    ...base,
    groups: nextGroups,
    activeGroupIndex: options?.activate === false ? base.activeGroupIndex : nextGroupIndex,
    activeSlotId: options?.activate === false ? base.activeSlotId : slotId,
    visible: true,
  });
}

export function removeTerminalFromPanel(
  panel: TerminalPanelState | null | undefined,
  slotId: string
): TerminalPanelState {
  const base = panel ?? createEmptyTerminalPanel();
  return normalizePanel({
    ...base,
    groups: base.groups.map((group) => ({
      ...group,
      children: group.children.filter((child) => child !== slotId),
    })),
    visible: true,
  });
}

export function reorderTerminalGroups(
  panel: TerminalPanelState | null | undefined,
  fromIndex: number,
  toIndex: number
): TerminalPanelState {
  const base = panel ?? createEmptyTerminalPanel();
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return base;
  const groups = [...base.groups];
  if (fromIndex >= groups.length || toIndex >= groups.length) return base;
  const [moved] = groups.splice(fromIndex, 1);
  groups.splice(toIndex, 0, moved);
  return normalizePanel({
    ...base,
    groups,
    activeGroupIndex:
      base.activeGroupIndex === fromIndex
        ? toIndex
        : base.activeGroupIndex > fromIndex && base.activeGroupIndex <= toIndex
          ? base.activeGroupIndex - 1
          : base.activeGroupIndex < fromIndex && base.activeGroupIndex >= toIndex
            ? base.activeGroupIndex + 1
            : base.activeGroupIndex,
  });
}

export function reorderTerminalGroupChildren(
  panel: TerminalPanelState | null | undefined,
  groupId: string,
  fromIndex: number,
  toIndex: number
): TerminalPanelState {
  const base = panel ?? createEmptyTerminalPanel();
  return normalizePanel({
    ...base,
    groups: base.groups.map((group) => {
      if (group.id !== groupId) return group;
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return group;
      if (fromIndex >= group.children.length || toIndex >= group.children.length) return group;
      const children = [...group.children];
      const [moved] = children.splice(fromIndex, 1);
      children.splice(toIndex, 0, moved);
      return { ...group, children };
    }),
  });
}

export function moveTerminalToGroup(
  panel: TerminalPanelState | null | undefined,
  slotId: string,
  targetGroupId: string,
  options?: {
    index?: number;
    activate?: boolean;
  }
): TerminalPanelState {
  const base = removeTerminalFromPanel(panel, slotId);
  return addTerminalToGroup(base, targetGroupId, slotId, options);
}

export function moveTerminalToNewGroup(
  panel: TerminalPanelState | null | undefined,
  slotId: string,
  index: number
): TerminalPanelState {
  const base = removeTerminalFromPanel(panel, slotId);
  return addTerminalGroup(base, slotId, { index, activate: true });
}

export function setActiveTerminalGroup(
  panel: TerminalPanelState | null | undefined,
  groupId: string,
  slotId?: string | null
): TerminalPanelState {
  const base = panel ?? createEmptyTerminalPanel();
  const activeGroupIndex = base.groups.findIndex((group) => group.id === groupId);
  if (activeGroupIndex < 0) return base;
  const group = base.groups[activeGroupIndex];
  return normalizePanel({
    ...base,
    activeGroupIndex,
    activeSlotId:
      slotId && group.children.includes(slotId) ? slotId : (group.children[0] ?? null),
    visible: group.children.length > 0,
  });
}

export function setActiveTerminalSlot(
  panel: TerminalPanelState | null | undefined,
  slotId: string | null
): TerminalPanelState {
  const base = panel ?? createEmptyTerminalPanel();
  if (slotId == null) {
    return normalizePanel({ ...base, activeSlotId: null });
  }
  const match = findTerminalGroupBySlot(base, slotId);
  if (!match) return base;
  return normalizePanel({
    ...base,
    activeGroupIndex: match.groupIndex,
    activeSlotId: slotId,
    visible: true,
  });
}

export function setTerminalPanelVisible(
  panel: TerminalPanelState | null | undefined,
  visible: boolean
): TerminalPanelState {
  const base = panel ?? createEmptyTerminalPanel();
  return normalizePanel({
    ...base,
    visible,
  });
}
