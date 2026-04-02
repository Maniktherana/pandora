import { Data } from "effect";

export class DaemonConnectionError extends Data.TaggedError("DaemonConnectionError")<{
  workspaceId: string;
  cause: unknown;
}> {}

export class DaemonSendError extends Data.TaggedError("DaemonSendError")<{
  workspaceId: string;
  cause: unknown;
}> {}

export class LayoutLoadError extends Data.TaggedError("LayoutLoadError")<{
  workspaceId: string;
  cause: unknown;
}> {}

export class RuntimeStartError extends Data.TaggedError("RuntimeStartError")<{
  workspaceId: string;
  cause: unknown;
}> {}
