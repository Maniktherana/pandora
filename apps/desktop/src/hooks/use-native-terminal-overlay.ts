import { useEffect } from "react";
import { terminalSurfaceService, type NativeTerminalOverlayMode } from "@/services/terminal/terminal-surface-service";

export function useNativeTerminalOverlay(mode: NativeTerminalOverlayMode | null) {
  useEffect(() => {
    if (!mode) return;

    void terminalSurfaceService.beginWebOverlay(mode).catch(() => {});

    return () => {
      void terminalSurfaceService.endWebOverlay(mode).catch(() => {});
    };
  }, [mode]);
}
