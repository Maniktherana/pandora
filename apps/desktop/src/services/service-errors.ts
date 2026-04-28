export class DesktopStateLoadError extends Error {
  readonly _tag = "DesktopStateLoadError";
  override readonly cause: unknown;
  constructor(params: { cause: unknown }) {
    super("DesktopStateLoadError");
    this.cause = params.cause;
  }
}

export class WorkspaceSelectionError extends Error {
  readonly _tag = "WorkspaceSelectionError";
  override readonly cause: unknown;
  readonly workspaceId?: string;
  constructor(params: { cause: unknown; workspaceId?: string }) {
    super("WorkspaceSelectionError");
    this.cause = params.cause;
    if (params.workspaceId !== undefined) this.workspaceId = params.workspaceId;
  }
}

export class LayoutMutationError extends Error {
  readonly _tag = "LayoutMutationError";
  override readonly cause: unknown;
  readonly workspaceId?: string;
  constructor(params: { cause: unknown; workspaceId?: string }) {
    super("LayoutMutationError");
    this.cause = params.cause;
    if (params.workspaceId !== undefined) this.workspaceId = params.workspaceId;
  }
}

export class NativeSurfaceError extends Error {
  readonly _tag = "NativeSurfaceError";
  override readonly cause: unknown;
  readonly surfaceId: string;
  constructor(params: { cause: unknown; surfaceId: string }) {
    super("NativeSurfaceError");
    this.cause = params.cause;
    this.surfaceId = params.surfaceId;
  }
}

export class UiPreferenceError extends Error {
  readonly _tag = "UiPreferenceError";
  override readonly cause: unknown;
  readonly key: string;
  constructor(params: { cause: unknown; key: string }) {
    super("UiPreferenceError");
    this.cause = params.cause;
    this.key = params.key;
  }
}

export class TerminalCommandError extends Error {
  readonly _tag = "TerminalCommandError";
  override readonly cause: unknown;
  readonly runtimeId?: string;
  constructor(params: { cause: unknown; runtimeId?: string }) {
    super("TerminalCommandError");
    this.cause = params.cause;
    if (params.runtimeId !== undefined) this.runtimeId = params.runtimeId;
  }
}
