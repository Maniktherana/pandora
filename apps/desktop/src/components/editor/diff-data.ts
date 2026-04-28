import type { DiffSource } from "@/lib/shared/types";
import {
  scmReadGitBlob,
  scmReadGitCompareBlob,
} from "@/services/scm/scm-api";

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
      scmReadGitCompareBlob(workspaceRoot, relativePath, targetBranch, "base"),
      scmReadGitCompareBlob(workspaceRoot, relativePath, targetBranch, "head"),
    ]);
    return { original, modified };
  }

  if (source === "staged") {
    const [original, modified] = await Promise.all([
      scmReadGitBlob(workspaceRoot, relativePath, "head"),
      scmReadGitBlob(workspaceRoot, relativePath, "index"),
    ]);
    return { original, modified };
  }

  const original = await scmReadGitBlob(workspaceRoot, relativePath, "head");
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
