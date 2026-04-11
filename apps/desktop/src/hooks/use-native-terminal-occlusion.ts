import { Effect } from "effect";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDesktopRuntime } from "@/hooks/use-bootstrap-desktop";
import {
  TerminalSurfaceService,
  type SurfaceRect,
} from "@/services/terminal/terminal-surface-service";

const DEFAULT_OCCLUSION_PADDING = 10;
const OCCLUSION_EXIT_HOLD_MS = 260;

function rectsEqual(a: SurfaceRect | null, b: SurfaceRect | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

function measureOcclusionRect(element: HTMLElement, padding: number): SurfaceRect | null {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const snap = (value: number) => Math.round(value * 4) / 4;
  return {
    x: snap(rect.left - padding),
    y: snap(rect.top - padding),
    width: snap(rect.width + padding * 2),
    height: snap(rect.height + padding * 2),
    scaleFactor: 1,
  };
}

export function useNativeTerminalOcclusion(
  active: boolean,
  padding = DEFAULT_OCCLUSION_PADDING,
  options: { exitHoldMs?: number } = {},
) {
  const runtime = useDesktopRuntime();
  const id = useId();
  const exitHoldMs = options.exitHoldMs ?? OCCLUSION_EXIT_HOLD_MS;
  const [element, setElement] = useState<HTMLElement | null>(null);
  const lastRectRef = useRef<SurfaceRect | null>(null);
  const rafRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  const clearScheduledMeasure = useCallback(() => {
    if (rafRef.current == null) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const sendRect = useCallback(
    (rect: SurfaceRect | null) => {
      if (rect && clearTimerRef.current != null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
      if (rectsEqual(lastRectRef.current, rect)) return;
      lastRectRef.current = rect;
      void runtime
        .runPromise(
          Effect.flatMap(TerminalSurfaceService, (manager) =>
            manager.setWebOcclusionRect(id, rect),
          ).pipe(Effect.catchAll(() => Effect.void)),
        )
        .catch(() => {});
    },
    [id, runtime],
  );

  const scheduleClearRect = useCallback(() => {
    if (clearTimerRef.current != null) {
      window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    if (exitHoldMs <= 0) {
      sendRect(null);
      return;
    }
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null;
      sendRect(null);
    }, exitHoldMs);
  }, [exitHoldMs, sendRect]);

  const measure = useCallback(() => {
    rafRef.current = null;
    if (!active || !element) {
      scheduleClearRect();
      return;
    }
    const rect = measureOcclusionRect(element, padding);
    if (rect) {
      sendRect(rect);
    } else {
      scheduleClearRect();
    }
  }, [active, element, padding, scheduleClearRect, sendRect]);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(measure);
  }, [measure]);

  useEffect(() => {
    if (!active || !element) {
      clearScheduledMeasure();
      scheduleClearRect();
      return;
    }

    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(element);
    window.addEventListener("resize", scheduleMeasure);
    document.addEventListener("scroll", scheduleMeasure, true);

    // Base UI positioners can settle over a few frames after mount as available size
    // variables resolve. Sample a short burst so the native mask follows that settle.
    let frames = 6;
    let settleRaf: number | null = null;
    const settle = () => {
      scheduleMeasure();
      frames -= 1;
      if (frames > 0) {
        settleRaf = requestAnimationFrame(settle);
      }
    };
    settleRaf = requestAnimationFrame(settle);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      document.removeEventListener("scroll", scheduleMeasure, true);
      if (settleRaf != null) cancelAnimationFrame(settleRaf);
      clearScheduledMeasure();
      scheduleClearRect();
    };
  }, [active, clearScheduledMeasure, element, scheduleClearRect, scheduleMeasure]);

  return setElement;
}
