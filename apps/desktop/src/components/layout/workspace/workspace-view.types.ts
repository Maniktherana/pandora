export type TerminalAnchorInfo = {
  el: HTMLElement;
  workspaceId: string;
  visible: boolean;
  focused: boolean;
  onFocus?: () => void;
};

export type NativeTerminalRegistration = {
  register: (sessionId: string, info: TerminalAnchorInfo | null) => void;
  workspaceVisible: boolean;
};
