export const preferenceKeys = {
  appShell: "app-shell",
  settings: "settings",
  fileTreeExpanded: "fileTreeExpanded",
  projectTerminalPanel: (projectIdOrKey: string) => `projectTerminalPanel:${projectIdOrKey}`,
} as const;
