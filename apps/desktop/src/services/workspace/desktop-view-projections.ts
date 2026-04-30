import type { WorkspaceRecord } from "@/lib/shared/types";

export type NavigationArea = "sidebar" | "workspace";

export interface WorkspaceView {
  readonly workspaceId: string;
  readonly workspace: WorkspaceRecord | null;
  readonly isSelected: boolean;
}
