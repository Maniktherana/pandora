import * as React from "react";
import { PanelResizeHandle } from "react-resizable-panels";
import { useNativeTerminalOcclusion } from "@/hooks/use-native-terminal-occlusion";
import { cn, panelResizeHandleClasses } from "@/lib/shared/utils";

type TerminalResizeHandleProps = Omit<
  React.ComponentProps<typeof PanelResizeHandle>,
  "className" | "onDragging"
> & {
  direction: "horizontal" | "vertical";
  className?: string;
  onDragging?: (isDragging: boolean) => void;
};

export default function TerminalResizeHandle({
  direction,
  className,
  onDragging,
  ...props
}: TerminalResizeHandleProps) {
  const [dragging, setDragging] = React.useState(false);
  const [resizeState, setResizeState] = React.useState<string | null>(null);
  const wrapperRef = React.useRef<HTMLSpanElement | null>(null);
  const occlusionActive = resizeState === "hover" || resizeState === "drag" || dragging;
  const setOcclusionElement = useNativeTerminalOcclusion(occlusionActive, 4, {
    exitHoldMs: 0,
  });

  React.useEffect(() => {
    const element = wrapperRef.current?.firstElementChild as HTMLElement | null;
    if (!element) return;
    setOcclusionElement(element);

    const syncState = () => {
      setResizeState(element.getAttribute("data-resize-handle-state"));
    };
    syncState();

    const observer = new MutationObserver(syncState);
    observer.observe(element, {
      attributes: true,
      attributeFilter: ["data-resize-handle-state"],
    });

    return () => {
      observer.disconnect();
      setOcclusionElement(null);
    };
  }, [setOcclusionElement]);

  const handleDragging = React.useCallback(
    (isDragging: boolean) => {
      setDragging(isDragging);
      onDragging?.(isDragging);
    },
    [onDragging],
  );

  return (
    <span ref={wrapperRef} className="contents">
      <PanelResizeHandle
        className={cn(panelResizeHandleClasses(direction), className)}
        onDragging={handleDragging}
        {...props}
      />
    </span>
  );
}
