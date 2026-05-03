/** Prefix for per-project terminal state keys. Kept wire-compatible with the backend key format. */
export const PROJECT_TERMINAL_KEY_PREFIX = "project:" as const;

export function projectTerminalKey(projectId: string): string {
  return `${PROJECT_TERMINAL_KEY_PREFIX}${projectId}`;
}

export function isProjectTerminalKey(key: string): boolean {
  return key.startsWith(PROJECT_TERMINAL_KEY_PREFIX);
}
