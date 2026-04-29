import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  RuntimeCommand,
  RuntimeEvent,
  RuntimeEventEnvelope,
} from "@/lib/shared/types";
import type { IpcQueueEvent } from "@/services/ipc/ipc-event-queue";

async function sendWithRetry(
  runtimeId: string,
  message: RuntimeCommand,
  maxAttempts = 21,
  delayMs = 100,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await invoke("scope_send", {
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
  console.error("IPC send failed after retries:", lastError);
  throw lastError;
}

export class IpcClient {
  private onEvent: (event: IpcQueueEvent) => void;
  private unlisteners: UnlistenFn[] = [];

  constructor(onEvent: (event: IpcQueueEvent) => void) {
    this.onEvent = onEvent;
  }

  async connect() {
    try {
      const unlisten = await listen<RuntimeEventEnvelope>("runtime-event", (event) => {
        try {
          const { runtimeId: scopeId, ...message } = event.payload;
          this.onEvent({ scopeId, ...(message as RuntimeEvent) });
        } catch (cause) {
          console.error("Failed to parse IPC event:", cause);
        }
      });

      this.unlisteners = [unlisten];
    } catch (cause) {
      console.error("Failed to connect IPC client:", cause);
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

  // Git commands (protocol names use scm_ prefix — backend naming)

  gitSubscribe(runtimeId: string, targetBranch?: string | null): Promise<void> {
    const cmd = targetBranch !== undefined
      ? { type: "scm_subscribe" as const, target_branch: targetBranch }
      : { type: "scm_subscribe" as const };
    return this.send(runtimeId, cmd);
  }

  gitRefresh(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_refresh" });
  }

  gitStage(runtimeId: string, paths: string[]): Promise<void> {
    return this.send(runtimeId, { type: "scm_stage", paths });
  }

  gitStageAll(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_stage_all" });
  }

  gitUnstage(runtimeId: string, paths: string[]): Promise<void> {
    return this.send(runtimeId, { type: "scm_unstage", paths });
  }

  gitUnstageAll(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_unstage_all" });
  }

  gitDiscardTracked(runtimeId: string, paths: string[]): Promise<void> {
    return this.send(runtimeId, { type: "scm_discard_tracked", paths });
  }

  gitDiscardUntracked(runtimeId: string, paths: string[]): Promise<void> {
    return this.send(runtimeId, { type: "scm_discard_untracked", paths });
  }

  gitCommit(runtimeId: string, message: string, push = false): Promise<void> {
    return this.send(runtimeId, { type: "scm_commit", message, push });
  }

  gitPush(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_push" });
  }

  gitFetch(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_fetch" });
  }

  gitPull(runtimeId: string): Promise<void> {
    return this.send(runtimeId, { type: "scm_pull" });
  }

  gitSetTargetBranch(runtimeId: string, branch: string | null): Promise<void> {
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

// Direct Tauri command invocations for git domain
// Command names use scm_ prefix (backend protocol naming — translation boundary)

type DiffResult = { diff: string; truncated: boolean };
type BlobSource = "head" | "index";
type CheckRunResult = {
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl: string;
  startedAt: string | null;
  completedAt: string | null;
};

export function ipcGitDiff(
  worktreePath: string,
  relativePath: string,
  staged: boolean,
): Promise<DiffResult> {
  return invoke<DiffResult>("scm_git_diff", { worktreePath, relativePath, staged });
}

export function ipcGitReadBlob(
  worktreePath: string,
  relativePath: string,
  source: BlobSource,
): Promise<string> {
  return invoke<string>("scm_read_git_blob", { worktreePath, relativePath, source });
}

export function ipcGitReadCompareBlob(
  worktreePath: string,
  relativePath: string,
  targetBranch: string,
  side: "base" | "head",
): Promise<string> {
  return invoke<string>("scm_read_git_compare_blob", {
    worktreePath,
    relativePath,
    targetBranch,
    side,
  });
}

export function ipcGitCheckRuns(worktreePath: string): Promise<CheckRunResult[]> {
  return invoke<CheckRunResult[]>("scm_check_runs", { worktreePath });
}
