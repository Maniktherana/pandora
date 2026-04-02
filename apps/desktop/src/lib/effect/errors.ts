import { Data } from "effect";

export class WorkspaceLoadError extends Data.TaggedError("WorkspaceLoadError")<{
  cause: unknown;
}> {}

export class WorkspaceSelectionError extends Data.TaggedError("WorkspaceSelectionError")<{
  cause: unknown;
  workspaceId?: string;
}> {}

export class LayoutMutationError extends Data.TaggedError("LayoutMutationError")<{
  cause: unknown;
  workspaceId?: string;
}> {}

export class NativeSurfaceError extends Data.TaggedError("NativeSurfaceError")<{
  cause: unknown;
  surfaceId: string;
}> {}

export class UiPreferenceError extends Data.TaggedError("UiPreferenceError")<{
  cause: unknown;
  key: string;
}> {}
