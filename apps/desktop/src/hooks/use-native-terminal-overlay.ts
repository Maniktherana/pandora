import { useEffect } from "react";
import { Effect } from "effect";
import { useDesktopRuntime } from "@/hooks/use-bootstrap-desktop";
import { TerminalSurfaceService } from "@/services/terminal/terminal-surface-service";

export function useNativeTerminalOverlay(active: boolean) {
  const runtime = useDesktopRuntime();

  useEffect(() => {
    if (!active) return;

    void runtime.runPromise(
      Effect.flatMap(TerminalSurfaceService, (manager) => manager.beginWebOverlay()).pipe(
        Effect.catchAll(() => Effect.void),
      ),
    );

    return () => {
      void runtime.runPromise(
        Effect.flatMap(TerminalSurfaceService, (manager) => manager.endWebOverlay()).pipe(
          Effect.catchAll(() => Effect.void),
        ),
      );
    };
  }, [active, runtime]);
}
