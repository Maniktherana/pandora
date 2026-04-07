export interface DragState {
  kind: "pane-tab" | "bottom-terminal-group" | "bottom-terminal-slot" | "file-tree-file";
  tabLabel: string;
  sourcePaneID?: string;
  sourceIndex?: number;
  runtimeId?: string;
  groupId?: string;
  groupIndex?: number;
  slotId?: string;
  slotIndex?: number;
  workspaceId?: string;
  workspaceRoot?: string;
  relativePath?: string;
}

export type DropZone = "center" | "left" | "right" | "top" | "bottom";

export interface PaneDropTarget {
  kind: "pane";
  paneID: string;
  zone: DropZone;
  rect: DOMRect;
}

export interface TabDropTarget {
  kind: "tab";
  paneID: string;
  insertIndex: number;
  lineX: number;
  barRect: DOMRect;
  tabBarVertical?: boolean;
  lineY?: number;
}

export interface BottomTerminalGroupDropTarget {
  kind: "bottom-terminal-group";
  runtimeId: string;
  groupId: string;
  groupIndex: number;
  rect: DOMRect;
}

export interface BottomTerminalInsertDropTarget {
  kind: "bottom-terminal-insert";
  runtimeId: string;
  insertIndex: number;
  barRect: DOMRect;
  lineY: number;
}

export interface BottomTerminalSlotDropTarget {
  kind: "bottom-terminal-slot";
  runtimeId: string;
  groupId: string;
  groupIndex: number;
  insertIndex: number;
  barRect: DOMRect;
  lineY: number;
}

export interface BottomTerminalPaneDropTarget {
  kind: "bottom-terminal-pane";
  runtimeId: string;
  groupId: string;
  slotId: string;
  zone: "center" | "left" | "right";
  rect: DOMRect;
}

export type DropTarget =
  | PaneDropTarget
  | TabDropTarget
  | BottomTerminalGroupDropTarget
  | BottomTerminalInsertDropTarget
  | BottomTerminalSlotDropTarget
  | BottomTerminalPaneDropTarget;
