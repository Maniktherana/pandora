import type { DiffSource } from "@/lib/shared/types";
import {
  readWorkspaceTextFile,
  scmReadGitBlob,
} from "@/components/layout/right-sidebar/scm/scm.utils";

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
) {
  return ["diff-contents", workspaceRoot, source, relativePath] as const;
}

export async function fetchDiffContents(
  workspaceRoot: string,
  relativePath: string,
  source: DiffSource,
): Promise<DiffContentsData> {
  if (source === "staged") {
    const [original, modified] = await Promise.all([
      scmReadGitBlob(workspaceRoot, relativePath, "head"),
      scmReadGitBlob(workspaceRoot, relativePath, "index"),
    ]);
    return { original, modified };
  }

  const original = await scmReadGitBlob(workspaceRoot, relativePath, "head");
  let modified = "";
  try {
    modified = await readWorkspaceTextFile(workspaceRoot, relativePath);
  } catch {
    modified = "";
  }
  return { original, modified };
}
