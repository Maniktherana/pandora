import type { TreeScmDecoration } from "@/components/layout/right-sidebar/scm/scm.types";

export const TREE_ROW_SELECTOR = "[data-tree-row-path]";
export const INTERNAL_DRAG_THRESHOLD_PX = 4;
export const SUPPRESS_CLICK_MS = 400;
export const SUPPRESS_HOVER_AFTER_DRAG_MS = 120;
export const TRANSPARENT_DRAG_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X3s0AAAAASUVORK5CYII=";
export const TREE_ROW_HEIGHT_PX = 24;
export const TREE_ROW_INDENT_PX = 12;
export const TREE_ROW_PADDING_LEFT_PX = 10;
export const DIRECTORY_STICKY_ROW_OFFSET_PX = TREE_ROW_HEIGHT_PX;
export const DIRECTORY_STICKY_Z_INDEX_BASE = 30;
export const STICKY_TOP_COMPENSATION_PX = 0;

export type DirEntry = { name: string; isDirectory: boolean; isIgnored?: boolean };

export type LeftPanelMode = "files" | "changes";

export type TreeRowKind = "file" | "directory";

export type TreeDropMode = "directory" | "root";

export type TreeDropTarget = {
  mode: TreeDropMode;
  targetRelPath: string | null;
};

export type DragPointer = {
  x: number;
  y: number;
};

export type NativeDragPayload =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

export type PendingPointerDrag = {
  sourceRelPath: string;
  sourceAbsPath: string;
  sourceKind: TreeRowKind;
  label: string;
  startPointer: DragPointer;
};

export type InternalTreeDragSession = {
  kind: "internal";
  sourceRelPath: string;
  sourceAbsPath: string;
  sourceKind: TreeRowKind;
  label: string;
  pointer: DragPointer;
  target: TreeDropTarget | null;
};

export type ExternalNativeTreeDragSession = {
  kind: "external-native";
  paths: string[];
  pointer: DragPointer;
  target: TreeDropTarget | null;
};

export type TreeDragSession = InternalTreeDragSession | ExternalNativeTreeDragSession;

export type ExpansionCtx = {
  isPathExpanded: (relPath: string) => boolean;
  setPathExpanded: (relPath: string, expanded: boolean) => void;
};

export type ScmDecorationResolver = (
  relPath: string,
  isDirectory: boolean,
  isIgnored?: boolean,
) => TreeScmDecoration;

export type PendingCreateState = {
  kind: "file" | "directory";
  parentRelPath: string;
} | null;

export type PendingRenameState = {
  kind: "file" | "directory";
  relPath: string;
  parentRelPath: string;
  currentName: string;
} | null;

export type FileTreeRowHandle = {
  kind: TreeRowKind;
  relPath: string;
  parentRelPath: string;
  label: string;
  absolutePath: string;
};
