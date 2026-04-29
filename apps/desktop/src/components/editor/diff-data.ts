import type { DiffSource } from "@/lib/shared/types";
import {
  gitReadBlob,
  gitReadCompareBlob,
} from "@/services/git/git-api";

export type DiffContentsData = {
  original: string;
  modified: string;
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
    if (!targetBranch) return { original: "", modified: "" };
    const [original, modified] = await Promise.all([
      gitReadCompareBlob(workspaceRoot, relativePath, targetBranch, "base"),
      gitReadCompareBlob(workspaceRoot, relativePath, targetBranch, "head"),
    ]);
    return { original, modified };
  }

  if (source === "staged") {
    const [original, modified] = await Promise.all([
      gitReadBlob(workspaceRoot, relativePath, "head"),
      gitReadBlob(workspaceRoot, relativePath, "index"),
    ]);
    return { original, modified };
  }

  const original = await gitReadBlob(workspaceRoot, relativePath, "head");
  let modified = "";
  if (readWorkingCopy) {
    try {
      modified = (await readWorkingCopy(relativePath)) ?? "";
    } catch {
      modified = "";
    }
  }
  return { original, modified };
}
