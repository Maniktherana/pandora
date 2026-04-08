import type {
  BottomTerminalGroupDropTarget,
  BottomTerminalInsertDropTarget,
  BottomTerminalPaneDropTarget,
  BottomTerminalSlotDropTarget,
  DragState,
  DropZone,
  FileTreeDropTarget,
  TabDropTarget,
} from "./tab-drag.types";

function isVisibleForHitTest(element: HTMLElement | null): boolean {
  let current: HTMLElement | null = element;
  while (current) {
    if (current.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    current = current.parentElement;
  }
  return true;
}

export function hitTestPanes(
  x: number,
  y: number,
  workspaceId: string | null,
): { paneID: string; rect: DOMRect; zone: DropZone } | null {
  const panes = document.querySelectorAll<HTMLElement>("[data-pane-id]");
  for (const pane of panes) {
    if (workspaceId && pane.dataset.workspaceId !== workspaceId) continue;
    if (!isVisibleForHitTest(pane)) continue;
    const rect = pane.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
      const rx = (x - rect.left) / rect.width;
      const ry = (y - rect.top) / rect.height;
      const edge = 0.25;
      let zone: DropZone;
      if (rx < edge) zone = "left";
      else if (rx > 1 - edge) zone = "right";
      else if (ry < edge) zone = "top";
      else if (ry > 1 - edge) zone = "bottom";
      else zone = "center";
      return { paneID: pane.dataset.paneId!, rect, zone };
    }
  }
  return null;
}

function unionRects(elements: HTMLElement[]): DOMRect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

export function hitTestBottomTerminalSidebar(
  x: number,
  y: number,
  dragState: DragState,
):
  | BottomTerminalGroupDropTarget
  | BottomTerminalInsertDropTarget
  | BottomTerminalSlotDropTarget
  | null {
  const groupRows = [
    ...document.querySelectorAll<HTMLElement>("[data-bottom-terminal-group-block='true']"),
  ].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

  if (groupRows.length === 0) return null;

  const sidebar = document.querySelector<HTMLElement>("[data-bottom-terminal-sidebar='true']");
  const barRect = sidebar?.getBoundingClientRect() ?? unionRects(groupRows);
  const pad = 8;
  if (
    x < barRect.left - pad ||
    x > barRect.right + pad ||
    y < barRect.top - pad ||
    y > barRect.bottom + pad
  ) {
    return null;
  }

  if (dragState.kind === "bottom-terminal-slot") {
    const slotRows = [
      ...document.querySelectorAll<HTMLElement>("[data-bottom-terminal-slot-index]"),
    ];
    for (const slotRow of slotRows) {
      const rect = slotRow.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      const midY = rect.top + rect.height / 2;
      return {
        kind: "bottom-terminal-slot",
        runtimeId: slotRow.dataset.bottomTerminalRuntimeId!,
        groupId: slotRow.dataset.bottomTerminalGroupId!,
        groupIndex: Number.parseInt(slotRow.dataset.bottomTerminalGroupIndex ?? "0", 10),
        insertIndex:
          Number.parseInt(slotRow.dataset.bottomTerminalSlotIndex ?? "0", 10) + (y >= midY ? 1 : 0),
        barRect,
        lineY: y >= midY ? rect.bottom : rect.top,
      };
    }

    for (const groupRow of groupRows) {
      const rect = groupRow.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    }
  }

  for (const groupRow of groupRows) {
    const rect = groupRow.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (y < midY) {
      return {
        kind: "bottom-terminal-insert",
        runtimeId: groupRow.dataset.bottomTerminalRuntimeId!,
        insertIndex: Number.parseInt(groupRow.dataset.bottomTerminalGroupIndex ?? "0", 10),
        barRect,
        lineY: rect.top,
      };
    }
  }

  const last = groupRows[groupRows.length - 1];
  const lastRect = last.getBoundingClientRect();
  return {
    kind: "bottom-terminal-insert",
    runtimeId: last.dataset.bottomTerminalRuntimeId!,
    insertIndex: Number.parseInt(last.dataset.bottomTerminalGroupIndex ?? "0", 10) + 1,
    barRect,
    lineY: lastRect.bottom,
  };
}

export function hitTestBottomTerminalPanes(
  x: number,
  y: number,
): BottomTerminalPaneDropTarget | null {
  const panes = document.querySelectorAll<HTMLElement>("[data-bottom-terminal-pane-id]");
  for (const pane of panes) {
    const rect = pane.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
    const rx = (x - rect.left) / rect.width;
    let zone: "center" | "left" | "right" = "center";
    if (rx < 0.25) zone = "left";
    else if (rx > 0.75) zone = "right";
    return {
      kind: "bottom-terminal-pane",
      runtimeId: pane.dataset.bottomTerminalRuntimeId!,
      groupId: pane.dataset.bottomTerminalGroupId!,
      slotId: pane.dataset.bottomTerminalPaneId!,
      zone,
      rect,
    };
  }
  return null;
}

export function hitTestTabs(
  x: number,
  y: number,
  workspaceId: string | null,
): TabDropTarget | null {
  const tabs = document.querySelectorAll<HTMLElement>("[data-tab-pane][data-tab-index]");
  if (tabs.length === 0) return null;

  const byPane = new Map<string, HTMLElement[]>();
  for (const tab of tabs) {
    if (tab.dataset.terminalSidebar === "true") continue;
    if (workspaceId && tab.dataset.workspaceId !== workspaceId) continue;
    if (!isVisibleForHitTest(tab)) continue;
    const paneID = tab.dataset.tabPane!;
    if (!byPane.has(paneID)) byPane.set(paneID, []);
    byPane.get(paneID)!.push(tab);
  }

  for (const [paneID, paneTabs] of byPane) {
    const sorted = [...paneTabs].sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
    );
    const firstRect = sorted[0].getBoundingClientRect();
    const lastRect = sorted[sorted.length - 1].getBoundingClientRect();
    const barTop = Math.min(...sorted.map((t) => t.getBoundingClientRect().top));
    const barBottom = Math.max(...sorted.map((t) => t.getBoundingClientRect().bottom));
    if (y < barTop || y > barBottom) continue;

    const barLeft = firstRect.left;
    const barRight = lastRect.right + 60;
    if (x < barLeft || x > barRight) continue;

    for (let i = 0; i < sorted.length; i++) {
      const rect = sorted[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      if (x < midX) {
        return {
          kind: "tab",
          paneID,
          insertIndex: i,
          lineX: rect.left,
          barRect: new DOMRect(barLeft, barTop, barRight - barLeft, barBottom - barTop),
        };
      }
    }

    return {
      kind: "tab",
      paneID,
      insertIndex: sorted.length,
      lineX: lastRect.right,
      barRect: new DOMRect(barLeft, barTop, barRight - barLeft, barBottom - barTop),
    };
  }

  return null;
}

export function hitTestFileTree(x: number, y: number): FileTreeDropTarget | null {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const sidebar = el.closest<HTMLElement>("[data-file-tree-sidebar='true']");
  if (sidebar) return { kind: "file-tree" };
  return null;
}
