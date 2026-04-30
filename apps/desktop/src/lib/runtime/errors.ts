export class RuntimeConnectionError extends Error {
  readonly _tag = "RuntimeConnectionError";
  override readonly cause: unknown;
  constructor(
    readonly scopeId: string,
    cause: unknown,
  ) {
    super(`Runtime connection error for ${scopeId}`);
    this.cause = cause;
  }
}

export class RuntimeSendError extends Error {
  readonly _tag = "RuntimeSendError";
  override readonly cause: unknown;
  constructor(
    readonly scopeId: string,
    cause: unknown,
  ) {
    super(`Runtime send error for ${scopeId}`);
    this.cause = cause;
  }
}

export class LayoutLoadError extends Error {
  readonly _tag = "LayoutLoadError";
  readonly workspaceId: string;
  override readonly cause: unknown;
  constructor(args: { workspaceId: string; cause: unknown }) {
    super(`Layout load error for ${args.workspaceId}`);
    this.workspaceId = args.workspaceId;
    this.cause = args.cause;
  }
}

export class RuntimeStartError extends Error {
  readonly _tag = "RuntimeStartError";
  readonly workspaceId: string;
  override readonly cause: unknown;
  constructor(args: { workspaceId: string; cause: unknown }) {
    super(`Runtime start error for ${args.workspaceId}`);
    this.workspaceId = args.workspaceId;
    this.cause = args.cause;
  }
}
