import { Data } from "effect";

export class AppRuntimeError extends Data.TaggedError("AppRuntimeError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class WorkspaceLoadError extends Data.TaggedError("WorkspaceLoadError")<{
  readonly workspaceId: string;
  readonly cause?: unknown;
}> {}

export class WorkspaceSelectionError extends Data.TaggedError("WorkspaceSelectionError")<{
  readonly workspaceId: string;
  readonly cause?: unknown;
}> {}

export class LayoutMutationError extends Data.TaggedError("LayoutMutationError")<{
  readonly workspaceId: string;
  readonly cause?: unknown;
}> {}

export class NativeSurfaceError extends Data.TaggedError("NativeSurfaceError")<{
  readonly workspaceId: string;
  readonly sessionId: string;
  readonly cause?: unknown;
}> {}

export class UiPreferenceError extends Data.TaggedError("UiPreferenceError")<{
  readonly key: string;
  readonly cause?: unknown;
}> {}

export class DaemonConnectionError extends Data.TaggedError("DaemonConnectionError")<{
  readonly workspaceId: string;
  readonly cause?: unknown;
}> {}

export class DaemonSendError extends Data.TaggedError("DaemonSendError")<{
  readonly workspaceId: string;
  readonly cause?: unknown;
}> {}

export class RuntimeStartError extends Data.TaggedError("RuntimeStartError")<{
  readonly workspaceId: string;
  readonly cause?: unknown;
}> {}
