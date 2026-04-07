import type {
  SessionState,
  SlotState,
  TerminalDisplayState,
} from "@/lib/shared/types";

export type TerminalTreeState = "none" | "start" | "middle" | "last";

export type SidebarRow = {
  groupId: string;
  groupIndex: number;
  slotId: string;
  slotIndex: number;
  display: TerminalDisplayState;
  treeState: TerminalTreeState;
};

export type ProjectTerminalAnchorInfo = {
  el: HTMLElement;
  visible: boolean;
  focused: boolean;
  onFocus?: () => void;
};

export type SlotMap = Map<string, SlotState>;
export type SessionMap = Map<string, SessionState>;
