import type { WorkspaceStatus } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";

interface AppStatusBarProps {
  connectionState: "connected" | "connecting" | "disconnected";
  workspaceStatus: WorkspaceStatus | null;
}

export default function AppStatusBar({
  connectionState,
  workspaceStatus,
}: AppStatusBarProps) {
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-[var(--theme-border)] bg-[#121212] px-3 text-[11px] text-[var(--theme-text-subtle)]">
      <div className="flex items-center min-w-0">
        {workspaceStatus === "ready" && (
          <>
            <div
              className={cn(
                "w-1.5 h-1.5 rounded-full mr-2 shrink-0",
                connectionState === "connected"
                  ? "bg-[var(--theme-success)]"
                  : connectionState === "connecting"
                    ? "bg-[var(--theme-warning)]"
                    : "bg-[var(--theme-error)]"
              )}
            />
            <span>
              {connectionState === "connected"
                ? "Connected"
                : connectionState === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
            </span>
          </>
        )}
        {workspaceStatus && workspaceStatus !== "ready" && (
          <span className="capitalize">{workspaceStatus}</span>
        )}
      </div>
    </div>
  );
}
