import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { LayoutNode, ProjectRecord, SessionState, SlotState, WorkspaceRecord, WorkspaceRuntimeState } from "@/lib/shared/types";
import type {
  DaemonMessage,
  ClientMessage,
} from "@/lib/shared/types";

export interface WorkspaceViewModel {
  readonly workspace: WorkspaceRecord;
  readonly runtime: WorkspaceRuntimeSnapshot | null;
  readonly isSelected: boolean;
  readonly isActive: boolean;
  readonly hasLayout: boolean;
  readonly layoutLoading: boolean;
  readonly layoutLoaded: boolean;
}

export interface WorkspaceRuntimeSnapshot {
  readonly workspaceId: string;
  readonly slots: readonly SlotState[];
  readonly sessions: readonly SessionState[];
  readonly connectionState: WorkspaceRuntimeState["connectionState"];
  readonly root: LayoutNode | null;
  readonly focusedPaneID: string | null;
  readonly layoutLoading: boolean;
  readonly layoutLoaded: boolean;
}

export interface ProjectTerminalViewModel {
  readonly projectId: string;
  readonly workspaceId: string;
  readonly visible: boolean;
  readonly runtime: WorkspaceRuntimeSnapshot | null;
}

export interface UiPreferencesViewModel {
  readonly sidebarVisible: boolean;
  readonly fileTreeOpenByWorkspaceId: Readonly<Record<string, boolean>>;
}

export interface AppViewModel {
  readonly projects: readonly ProjectRecord[];
  readonly workspaces: readonly WorkspaceViewModel[];
  readonly selectedProjectId: string | null;
  readonly selectedWorkspaceId: string | null;
  readonly navigationArea: "sidebar" | "workspace";
  readonly searchText: string;
  readonly layoutTargetRuntimeId: string | null;
  readonly uiPreferences: UiPreferencesViewModel;
}

export interface SurfaceAnchorRegistration {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly surfaceId: string;
  readonly visible: boolean;
  readonly focused: boolean;
  readonly anchorElement?: HTMLElement | null;
  readonly onFocus?: () => void;
}

export interface SurfaceReleaseKey {
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly surfaceId: string;
}

export interface WorkspaceRegistryService {
  readonly view: SubscriptionRef.SubscriptionRef<AppViewModel>;
  readonly refresh: Effect.Effect<void>;
  readonly loadAppState: Effect.Effect<void>;
  readonly reloadFromBackend: Effect.Effect<void>;
  readonly selectProject: (projectId: string) => Effect.Effect<void>;
  readonly selectWorkspace: (workspaceId: string) => Effect.Effect<void>;
  readonly createWorkspace: (projectId: string) => Effect.Effect<void>;
  readonly retryWorkspace: (workspaceId: string) => Effect.Effect<void>;
  readonly removeWorkspace: (workspaceId: string) => Effect.Effect<void>;
  readonly markWorkspaceOpened: (workspaceId: string) => Effect.Effect<void>;
  readonly setNavigationArea: (area: "sidebar" | "workspace") => Effect.Effect<void>;
  readonly setSearchText: (text: string) => Effect.Effect<void>;
}

export interface UiPreferencesService {
  readonly view: SubscriptionRef.SubscriptionRef<UiPreferencesViewModel>;
  readonly refresh: Effect.Effect<void>;
  readonly loadSidebarVisible: Effect.Effect<boolean>;
  readonly saveSidebarVisible: (visible: boolean) => Effect.Effect<void>;
  readonly loadFileTreeOpen: (workspaceId: string) => Effect.Effect<boolean>;
  readonly saveFileTreeOpen: (workspaceId: string, open: boolean) => Effect.Effect<void>;
  readonly loadSelection: Effect.Effect<{
    readonly projectId: string | null;
    readonly workspaceId: string | null;
  }>;
  readonly saveSelection: (projectId: string | null, workspaceId: string | null) => Effect.Effect<void>;
}

export interface DaemonGatewayService {
  readonly view: SubscriptionRef.SubscriptionRef<{
    readonly connectionState: "disconnected" | "connecting" | "connected";
    readonly lastMessage: DaemonMessage | null;
  }>;
  readonly connect: Effect.Effect<void>;
  readonly disconnect: Effect.Effect<void>;
  readonly send: (workspaceId: string, message: ClientMessage) => Effect.Effect<void>;
  readonly input: (workspaceId: string, sessionID: string, data: string) => Effect.Effect<void>;
  readonly resize: (workspaceId: string, sessionID: string, cols: number, rows: number) => Effect.Effect<void>;
  readonly openSessionInstance: (workspaceId: string, sessionDefID: string) => Effect.Effect<void>;
}

export interface NativeSurfaceManagerService {
  readonly view: SubscriptionRef.SubscriptionRef<{
    readonly surfaces: Readonly<Record<string, SurfaceAnchorRegistration>>;
  }>;
  readonly registerAnchor: (input: SurfaceAnchorRegistration) => Effect.Effect<SurfaceReleaseKey>;
  readonly updateVisibility: (
    key: SurfaceReleaseKey,
    input: Pick<SurfaceAnchorRegistration, "visible" | "focused" | "anchorElement" | "onFocus">
  ) => Effect.Effect<void>;
  readonly releaseSurface: (key: SurfaceReleaseKey) => Effect.Effect<void>;
}

export class WorkspaceRegistry extends Context.Tag("pandora/WorkspaceRegistry")<
  WorkspaceRegistry,
  WorkspaceRegistryService
>() {}

export class UiPreferences extends Context.Tag("pandora/UiPreferences")<
  UiPreferences,
  UiPreferencesService
>() {}

export class DaemonGateway extends Context.Tag("pandora/DaemonGateway")<
  DaemonGateway,
  DaemonGatewayService
>() {}

export class NativeSurfaceManager extends Context.Tag("pandora/NativeSurfaceManager")<
  NativeSurfaceManager,
  NativeSurfaceManagerService
>() {}
