import { useEffect, useMemo } from "react";
import { Effect } from "effect";
import { getAppRuntime } from "@/lib/effect/app-runtime";
import { UiPreferences } from "@/lib/effect/services/ui-preferences";
import { WorkspaceRegistry } from "@/lib/effect/services/workspace-registry";

let bootstrapped = false;

export function useAppRuntime() {
  return useMemo(() => getAppRuntime(), []);
}

export function useBootAppRuntime() {
  const runtime = useAppRuntime();

  useEffect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void runtime.runPromise(
      Effect.gen(function* () {
        const workspaceRegistry = yield* WorkspaceRegistry;
        const uiPreferences = yield* UiPreferences;
        yield* workspaceRegistry.loadAppState();
        yield* uiPreferences.hydrate();
      })
    );
  }, [runtime]);
}
