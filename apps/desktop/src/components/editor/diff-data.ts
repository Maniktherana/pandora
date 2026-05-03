import type { DiffSource } from "@/lib/shared/shared.types";
import {
  ipcGitReadBlob,
  ipcGitReadCompareBlob,
} from "@/lib/services/ipc/client";
import { hashDiffText } from "@/lib/shared/hash";

export type DiffContentsData = {
  original: string;
  modified: string;
  originalHash: string;
  modifiedHash: string;
};

export const DIFF_CONTENTS_STALE_TIME_MS = 2 * 60_000;
export const DIFF_CONTENTS_GC_TIME_MS = 30 * 60_000;

export function diffContentsQueryKey(
  workspaceRoot: string,
  relativePath: string,
  source: DiffSource,
  targetBranch?: string | null,
) {
  return ["diff-contents", workspaceRoot, source, relativePath, targetBranch ?? null] as const;
}

export async function fetchDiffContents(
  workspaceRoot: string,
  relativePath: string,
  source: DiffSource,
  targetBranch?: string | null,
  readWorkingCopy?: (relativePath: string) => Promise<string | null>,
): Promise<DiffContentsData> {
  if (source === "branch") {
    if (!targetBranch) {
      return { original: "", modified: "", originalHash: hashDiffText(""), modifiedHash: hashDiffText("") };
    }
    const [original, modified] = await Promise.all([
      ipcGitReadCompareBlob(workspaceRoot, relativePath, targetBranch, "base"),
      ipcGitReadCompareBlob(workspaceRoot, relativePath, targetBranch, "head"),
    ]);
    return { original, modified, originalHash: hashDiffText(original), modifiedHash: hashDiffText(modified) };
  }

  if (source === "staged") {
    const [original, modified] = await Promise.all([
      ipcGitReadBlob(workspaceRoot, relativePath, "head"),
      ipcGitReadBlob(workspaceRoot, relativePath, "index"),
    ]);
    return { original, modified, originalHash: hashDiffText(original), modifiedHash: hashDiffText(modified) };
  }

  const original = await ipcGitReadBlob(workspaceRoot, relativePath, "head");
  let modified = "";
  if (readWorkingCopy) {
    try {
      modified = (await readWorkingCopy(relativePath)) ?? "";
    } catch {
      modified = "";
    }
  }
  return { original, modified, originalHash: hashDiffText(original), modifiedHash: hashDiffText(modified) };
}
