import type {
  AppState,
  WorkspaceRecord,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { useDesktopViewStore } from "@/services/workspace/desktop-view-store";
import { useRuntimeStore } from "@/services/runtime/runtime-store";
import {
  buildDesktopView,
  type DesktopViewStateSnapshot,
} from "@/services/workspace/desktop-view-projections";
import { createWorkspaceRuntimeState } from "@/services/workspace/workspace-runtime-model";

// ─── snapshot type ────────────────────────────────────────────────────────────

export type DesktopStateSnapshot = {
  -readonly [K in keyof DesktopViewStateSnapshot]: DesktopViewStateSnapshot[K] extends Readonly<
    Record<string, infer V>
  >
    ? Record<string, V>
    : DesktopViewStateSnapshot[K] extends readonly (infer U)[]
      ? U[]
      : DesktopViewStateSnapshot[K];
} & {
  runtimes: Record<string, WorkspaceRuntimeState>;
  prAwaitingWorkspaceIds: Set<string>;
};

// ─── singleton ────────────────────────────────────────────────────────────────

export const desktopStateSnapshot: DesktopStateSnapshot = {
  projects: [],
  workspaces: [],
  selectedProjectID: null,
  selectedWorkspaceID: null,
  runtimes: {},
  navigationArea: "sidebar",
  searchText: "",
  layoutTargetRuntimeId: null,
  prAwaitingWorkspaceIds: new Set<string>(),
};

// ─── publish scheduling ───────────────────────────────────────────────────────

let desktopPublishScheduled = false;
let runtimePublishScheduled = false;

function publishDesktopView(snapshot: DesktopViewStateSnapshot) {
  useDesktopViewStore.getState().setDesktopView(buildDesktopView(snapshot));
}

function publishRuntimeState(runtimes: Record<string, WorkspaceRuntimeState>) {
  useRuntimeStore.getState().setRuntimeState({ ...runtimes });
}

export const publishDesktopNow = () => publishDesktopView(desktopStateSnapshot);

export const scheduleDesktopPublish = () => {
  if (desktopPublishScheduled) return;
  desktopPublishScheduled = true;
  queueMicrotask(() => {
    desktopPublishScheduled = false;
    publishDesktopNow();
  });
};

export const publishRuntimeNow = () => publishRuntimeState(desktopStateSnapshot.runtimes);

export const scheduleRuntimePublish = () => {
  if (runtimePublishScheduled) return;
  runtimePublishScheduled = true;
  queueMicrotask(() => {
    runtimePublishScheduled = false;
    publishRuntimeNow();
  });
};

// ─── state helpers ────────────────────────────────────────────────────────────

export function compareCreatedAtDesc<T extends { createdAt: string }>(a: T, b: T) {
  return b.createdAt.localeCompare(a.createdAt);
}

export function cloneRuntimeState(runtime: WorkspaceRuntimeState): WorkspaceRuntimeState {
  return structuredClone(runtime);
}

export function readSessionRuntimeState(workspaceId: string): WorkspaceRuntimeState {
  const existing = desktopStateSnapshot.runtimes[workspaceId];
  if (existing) return existing;
  const runtime = createWorkspaceRuntimeState(workspaceId);
  desktopStateSnapshot.runtimes[workspaceId] = runtime;
  scheduleRuntimePublish();
  return runtime;
}

export function writeSessionRuntimeState(workspaceId: string, runtime: WorkspaceRuntimeState) {
  desktopStateSnapshot.runtimes[workspaceId] = runtime;
  scheduleRuntimePublish();
}

export function updateDesktopState(
  mutate: (state: DesktopStateSnapshot) => void,
  options?: { sync?: boolean },
) {
  mutate(desktopStateSnapshot);
  if (options?.sync) {
    publishDesktopNow();
  } else {
    scheduleDesktopPublish();
  }
}

// ─── workspace record helpers ─────────────────────────────────────────────────

export function replaceWorkspaceRecord(
  workspaces: WorkspaceRecord[],
  workspaceId: string,
  mutate: (workspace: WorkspaceRecord) => void,
) {
  let changed = false;
  const nextWorkspaces = workspaces.map((workspace) => {
    if (workspace.id !== workspaceId) return workspace;
    changed = true;
    const nextWorkspace = structuredClone(workspace);
    mutate(nextWorkspace);
    return nextWorkspace;
  });
  return changed ? nextWorkspaces.sort(compareCreatedAtDesc) : workspaces;
}

export function patchWorkspaceRecord(record: WorkspaceRecord) {
  const nextRecord = structuredClone(record);
  const index = desktopStateSnapshot.workspaces.findIndex((entry) => entry.id === record.id);
  if (index >= 0) {
    const nextWorkspaces = [...desktopStateSnapshot.workspaces];
    nextWorkspaces[index] = nextRecord;
    desktopStateSnapshot.workspaces = nextWorkspaces.sort(compareCreatedAtDesc);
  } else {
    desktopStateSnapshot.workspaces = [
      nextRecord,
      ...desktopStateSnapshot.workspaces,
    ].sort(compareCreatedAtDesc);
  }
  scheduleDesktopPublish();
}

export function getVisibleSidebarWorkspaces() {
  return desktopStateSnapshot.projects.flatMap((project) =>
    desktopStateSnapshot.workspaces.filter(
      (workspace) =>
        workspace.projectId === project.id && workspace.status !== "archived",
    ),
  );
}

// ─── app state application ────────────────────────────────────────────────────

export function applyAppState(appState: AppState): { allowedRuntimeIds: Set<string> } {
  desktopStateSnapshot.projects = structuredClone(appState.projects).sort(compareCreatedAtDesc);
  desktopStateSnapshot.workspaces = structuredClone(appState.workspaces).sort(compareCreatedAtDesc);
  desktopStateSnapshot.selectedProjectID = appState.selectedProjectId;
  desktopStateSnapshot.selectedWorkspaceID = appState.selectedWorkspaceId;

  const allowedRuntimeIds = new Set<string>(appState.workspaces.map((w) => w.id));
  for (const project of appState.projects) allowedRuntimeIds.add(`project:${project.id}`);
  for (const runtimeId of Object.keys(desktopStateSnapshot.runtimes)) {
    if (!allowedRuntimeIds.has(runtimeId)) delete desktopStateSnapshot.runtimes[runtimeId];
  }

  scheduleDesktopPublish();
  scheduleRuntimePublish();

  return { allowedRuntimeIds };
}
