import { useGitStore } from "./git-store";

/**
 * Lightweight hook that exposes only the branch-context slice of git state.
 *
 * Branch-context is fetched lazily (on user request to open the branch
 * picker) rather than pushed by the subscription stream, so it lives in a
 * narrow Zustand store rather than React Query.
 */
export function useBranchContext(scopeId: string) {
  const branchContext = useGitStore((s) => s.byScopeId[scopeId]?.branchContext ?? null);
  const branchContextLoading = useGitStore(
    (s) => s.byScopeId[scopeId]?.branchContextLoading ?? false,
  );
  return { branchContext, branchContextLoading };
}
