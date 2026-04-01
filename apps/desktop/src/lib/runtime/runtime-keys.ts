/** Prefix for per-project daemon/runtime keys (bottom panel shell). */
export const PROJECT_RUNTIME_PREFIX = "project:" as const;

export function projectRuntimeKey(projectId: string): string {
  return `${PROJECT_RUNTIME_PREFIX}${projectId}`;
}

export function isProjectRuntimeKey(runtimeId: string): boolean {
  return runtimeId.startsWith(PROJECT_RUNTIME_PREFIX);
}
