/** Prefix for per-project runtime keys (bottom panel shell). */
export const PROJECT_RUNTIME_PREFIX = "project:" as const;

export function projectRuntimeKey(projectId: string): string {
  return `${PROJECT_RUNTIME_PREFIX}${projectId}`;
}

export function isProjectRuntimeKey(scopeId: string): boolean {
  return scopeId.startsWith(PROJECT_RUNTIME_PREFIX);
}
