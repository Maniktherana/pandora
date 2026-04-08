import { useEffect } from "react";
import { Effect } from "effect";
import { useDesktopRuntime } from "@/hooks/use-bootstrap-desktop";
import {
  type NativeTerminalOverlayMode,
  TerminalSurfaceService,
} from "@/services/terminal/terminal-surface-service";

export function useNativeTerminalOverlay(mode: NativeTerminalOverlayMode | null) {
  const runtime = useDesktopRuntime();

  useEffect(() => {
    if (!mode) return;

    void runtime.runPromise(
      Effect.flatMap(TerminalSurfaceService, (manager) => manager.beginWebOverlay(mode)).pipe(
        Effect.catchAll(() => Effect.void),
      ),
    );

    return () => {
      void runtime.runPromise(
        Effect.flatMap(TerminalSurfaceService, (manager) => manager.endWebOverlay(mode)).pipe(
          Effect.catchAll(() => Effect.void),
        ),
      );
    };
  }, [mode, runtime]);
}
