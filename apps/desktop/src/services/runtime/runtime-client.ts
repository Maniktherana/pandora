import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  RuntimeConnectionEvent,
  RuntimeCommand,
  RuntimeEvent,
  RuntimeEventEnvelope,
} from "@/lib/shared/types";
import type { RuntimeQueueEvent } from "@/services/runtime/runtime-event-queue";

export type ConnectionState = "disconnected" | "connecting" | "connected";

async function sendWithRetry(
  runtimeId: string,
  message: RuntimeCommand,
  maxAttempts = 21,
  delayMs = 100,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await invoke("runtime_send", {
        runtimeId,
        message: JSON.stringify(message),
      });
      return;
    } catch (cause) {
      lastError = cause;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  console.error("Runtime send failed after retries:", lastError);
  throw lastError;
}

export class RuntimeClient {
  private onEvent: (event: RuntimeQueueEvent) => void;
  private unlisteners: UnlistenFn[] = [];

  constructor(onEvent: (event: RuntimeQueueEvent) => void) {
    this.onEvent = onEvent;
  }

  async connect() {
    try {
      const unlisten1 = await listen<RuntimeConnectionEvent>("runtime-connection", (event) => {
        try {
          const state: ConnectionState =
            event.payload.state === "connected" ? "connected" : "disconnected";
          this.onEvent({ type: "connection_state_changed", runtimeId: event.payload.runtimeId, state });
        } catch (cause) {
          console.error("Failed to parse runtime connection event:", cause);
        }
      });

      const unlisten2 = await listen<RuntimeEventEnvelope>("runtime-event", (event) => {
        try {
          const { runtimeId, ...message } = event.payload;
          this.onEvent({ runtimeId, ...(message as RuntimeEvent) });
        } catch (cause) {
          console.error("Failed to parse runtime event:", cause);
        }
      });

      this.unlisteners = [unlisten1, unlisten2];
    } catch (cause) {
      console.error("Failed to connect runtime client:", cause);
    }
  }

  disconnect() {
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];
  }

  async send(runtimeId: string, message: RuntimeCommand) {
    await sendWithRetry(runtimeId, message);
  }

  // Terminal / process commands

  input(runtimeId: string, sessionID: string, data: string): Promise<void> {
    return this.send(runtimeId, { type: "input", sessionID, data });
  }

  resize(runtimeId: string, sessionID: string, cols: number, rows: number): Promise<void> {
    return this.send(runtimeId, { type: "resize", sessionID, cols, rows });
  }

  openSessionInstance(runtimeId: string, sessionDefID: string): Promise<void> {
    return this.send(runtimeId, { type: "open_session_instance", sessionDefID });
  }

  requestSnapshot(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "request_snapshot" });
  }

  // File tree commands

  fileTreeSubscribe(runtimeId: string, expandedPaths: string[] = []): Promise<void> {
    return this.send(runtimeId, { type: "file_tree_subscribe", expanded_paths: expandedPaths });
  }

  fileTreeSetExpandedPaths(runtimeId: string, paths: string[]): Promise<void> {
    return this.send(runtimeId, { type: "file_tree_set_expanded_paths", paths });
  }

  fileTreeRefresh(runtimeId: string, path?: string): Promise<void> {
    const cmd = path !== undefined
      ? { type: "file_tree_refresh" as const, path }
      : { type: "file_tree_refresh" as const };
    return this.send(runtimeId, cmd);
  }

  fileTreeCreateFile(runtimeId: string, parentRelativePath: string, name: string, contents = ""): Promise<void> {
    return this.send(runtimeId, {
      type: "file_tree_create_file",
      parent_relative_path: parentRelativePath,
      name,
      contents,
    });
  }

  fileTreeCreateDirectory(runtimeId: string, relativePath: string): Promise<void> {
    return this.send(runtimeId, { type: "file_tree_create_directory", relative_path: relativePath });
  }

  fileTreeRename(runtimeId: string, sourceRelativePath: string, newName: string): Promise<void> {
    return this.send(runtimeId, {
      type: "file_tree_rename",
      source_relative_path: sourceRelativePath,
      new_name: newName,
    });
  }

  fileTreeDelete(runtimeId: string, relativePath: string): Promise<void> {
    return this.send(runtimeId, { type: "file_tree_delete", relative_path: relativePath });
  }

  fileTreeMove(runtimeId: string, sourceRelativePath: string, destRelativePath: string): Promise<void> {
    return this.send(runtimeId, {
      type: "file_tree_move",
      source_relative_path: sourceRelativePath,
      dest_relative_path: destRelativePath,
    });
  }

  fileTreeCopy(runtimeId: string, sourceRelativePath: string, destRelativePath: string): Promise<void> {
    return this.send(runtimeId, {
      type: "file_tree_copy",
      source_relative_path: sourceRelativePath,
      dest_relative_path: destRelativePath,
    });
  }

  fileTreeImport(runtimeId: string, destRelativePath: string, sourceAbsolutePaths: string[]): Promise<void> {
    return this.send(runtimeId, {
      type: "file_tree_import",
      dest_relative_path: destRelativePath,
      source_absolute_paths: sourceAbsolutePaths,
    });
  }

  async fileTreeReadTextFile(runtimeId: string, requestID: string, relativePath: string): Promise<void> {
    await this.send(runtimeId, {
      type: "file_tree_read_text_file",
      requestID,
      relative_path: relativePath,
    });
  }

  async fileTreeWriteTextFile(
    runtimeId: string,
    requestID: string,
    relativePath: string,
    contents: string,
  ): Promise<void> {
    await this.send(runtimeId, {
      type: "file_tree_write_text_file",
      requestID,
      relative_path: relativePath,
      contents,
    });
  }

  // SCM commands

  scmSubscribe(runtimeId: string, targetBranch?: string | null): Promise<void> {
    const cmd = targetBranch !== undefined
      ? { type: "scm_subscribe" as const, target_branch: targetBranch }
      : { type: "scm_subscribe" as const };
    return this.send(runtimeId, cmd);
  }

  scmRefresh(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_refresh" });
  }

  scmStage(runtimeId: string, paths: string[]): Promise<void> {
    return this.send(runtimeId, { type: "scm_stage", paths });
  }

  scmStageAll(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_stage_all" });
  }

  scmUnstage(runtimeId: string, paths: string[]): Promise<void> {
    return this.send(runtimeId, { type: "scm_unstage", paths });
  }

  scmUnstageAll(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_unstage_all" });
  }

  scmDiscardTracked(runtimeId: string, paths: string[]): Promise<void> {
    return this.send(runtimeId, { type: "scm_discard_tracked", paths });
  }

  scmDiscardUntracked(runtimeId: string, paths: string[]): Promise<void> {
    return this.send(runtimeId, { type: "scm_discard_untracked", paths });
  }

  scmCommit(runtimeId: string, message: string, push = false): Promise<void> {
    return this.send(runtimeId, { type: "scm_commit", message, push });
  }

  scmPush(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_push" });
  }

  scmFetch(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_fetch" });
  }

  scmPull(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_pull" });
  }

  scmSetTargetBranch(runtimeId: string, branch: string | null): Promise<void> {
    return this.send(runtimeId, { type: "scm_set_target_branch", branch });
  }

  // Editor IO commands

  async editorReadTextFile(runtimeId: string, requestID: string, relativePath: string): Promise<void> {
    await this.send(runtimeId, {
      type: "editor_read_text_file",
      requestID,
      relative_path: relativePath,
    });
  }

  async editorWriteTextFile(
    runtimeId: string,
    requestID: string,
    relativePath: string,
    contents: string,
  ): Promise<void> {
    await this.send(runtimeId, {
      type: "editor_write_text_file",
      requestID,
      relative_path: relativePath,
      contents,
    });
  }
}
