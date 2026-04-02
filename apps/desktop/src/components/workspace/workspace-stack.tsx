import { memo } from "react";
import { WorkspaceRuntimeView } from "@/components/workspace/workspace-view";
import type { WorkspaceRuntimeState } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";

type LoadedWorkspaceRuntimeState = Omit<WorkspaceRuntimeState, "root"> & {
  root: NonNullable<WorkspaceRuntimeState["root"]>;
};

export interface WorkspaceStackItem {
  workspaceId: string;
  workspaceRoot: string;
  runtime: LoadedWorkspaceRuntimeState;
  isActive: boolean;
  layoutTargetOnFocus?: string | null;
}

interface WorkspaceStackProps {
  items: WorkspaceStackItem[];
  className?: string;
}

function WorkspaceStack({ items, className }: WorkspaceStackProps) {
  return (
    <div className={cn("relative h-full min-h-0", className)}>
      {items.map((item) => (
        <div
          key={item.workspaceId}
          className="absolute inset-0"
          style={{
            visibility: item.isActive ? "visible" : "hidden",
            pointerEvents: item.isActive ? "auto" : "none",
          }}
          aria-hidden={!item.isActive}
        >
          <WorkspaceRuntimeView
            workspaceId={item.workspaceId}
            workspaceRoot={item.workspaceRoot}
            runtime={item.runtime}
            layoutTargetOnFocus={item.layoutTargetOnFocus ?? null}
            isVisible={item.isActive}
          />
        </div>
      ))}
    </div>
  );
}

export default memo(WorkspaceStack);
