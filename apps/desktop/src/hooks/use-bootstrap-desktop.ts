import { useCallback, useEffect, useMemo, useRef } from "react";
import { Effect } from "effect";
import { getDesktopRuntime } from "@/app/desktop-runtime";
import { DaemonGateway } from "@/services/daemon/daemon-gateway";
import { UiPreferencesService } from "@/services/preferences/ui-preferences-service";
import { DesktopWorkspaceService } from "@/services/workspace/desktop-workspace-service";

export function useDesktopRuntime() {
  return useMemo(() => getDesktopRuntime(), []);
}

export function useDesktopEffectRunner() {
  const runtime = useDesktopRuntime();

  const run = useCallback(
    <A, E, R>(effect: Effect.Effect<A, E, R>) => {
      void runtime.runPromise(effect as Effect.Effect<A, E, never>);
    },
    [runtime]
  );

  const runPromise = useCallback(
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      runtime.runPromise(effect as Effect.Effect<A, E, never>),
    [runtime]
  );

  return { run, runPromise };
}

export function useBootstrapDesktop() {
  const runtime = useDesktopRuntime();
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    void runtime.runPromise(
      Effect.gen(function* () {
        const daemonGateway = yield* DaemonGateway;
        const desktopWorkspace = yield* DesktopWorkspaceService;
        const uiPreferences = yield* UiPreferencesService;
        yield* daemonGateway.connect();
        yield* desktopWorkspace.loadDesktopState();
        yield* uiPreferences.hydrate();
      })
    );
  }, [runtime]);
}
