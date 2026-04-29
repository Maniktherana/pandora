export interface DragState {
  kind: "pane-tab" | "bottom-terminal-group" | "bottom-terminal-slot" | "file-tree-file";
  tabLabel: string;
  sourcePaneID?: string;
  sourceIndex?: number;
  scopeId?: string;
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
  scopeId: string;
  groupId: string;
  groupIndex: number;
  rect: DOMRect;
}

export interface BottomTerminalInsertDropTarget {
  kind: "bottom-terminal-insert";
  scopeId: string;
  insertIndex: number;
  barRect: DOMRect;
  lineY: number;
}

export interface BottomTerminalSlotDropTarget {
  kind: "bottom-terminal-slot";
  scopeId: string;
  groupId: string;
  groupIndex: number;
  insertIndex: number;
  barRect: DOMRect;
  lineY: number;
}

export interface BottomTerminalPaneDropTarget {
  kind: "bottom-terminal-pane";
  scopeId: string;
  groupId: string;
  slotId: string;
  zone: "center" | "left" | "right";
  rect: DOMRect;
}

export interface FileTreeDropTarget {
  kind: "file-tree";
}

export type DropTarget =
  | PaneDropTarget
  | TabDropTarget
  | BottomTerminalGroupDropTarget
  | BottomTerminalInsertDropTarget
  | BottomTerminalSlotDropTarget
  | BottomTerminalPaneDropTarget
  | FileTreeDropTarget;
