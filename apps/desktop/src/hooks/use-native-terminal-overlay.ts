import { useEffect } from "react";
import { terminalSurfaceService, type NativeTerminalOverlayMode } from "@/lib/services/terminal/surface";

export function useNativeTerminalOverlay(mode: NativeTerminalOverlayMode | null) {
  useEffect(() => {
    if (!mode) return;

    void terminalSurfaceService.beginWebOverlay(mode).catch(() => {});

    return () => {
      void terminalSurfaceService.endWebOverlay(mode).catch(() => {});
    };
  }, [mode]);
}
