import { describe, expect, test } from "bun:test";
import {
  compareScmPathsByTreeOrder,
  sortScmEntriesByTreeOrder,
} from "./scm.utils";
import type { ScmStatusEntry } from "./scm.types";

function entry(path: string): ScmStatusEntry {
  return {
    path,
    origPath: null,
    stagedKind: null,
    worktreeKind: "M",
    untracked: false,
  };
}

describe("compareScmPathsByTreeOrder", () => {
  test("matches file-tree ordering for nested folders and root files", () => {
    expect(
      [
        "zeta.ts",
        "src/app.ts",
        "src/components/button.tsx",
        "README.md",
      ].sort(compareScmPathsByTreeOrder),
    ).toEqual([
      "src/components/button.tsx",
      "src/app.ts",
      "README.md",
      "zeta.ts",
    ]);
  });

  test("keeps sibling files in name order within the same folder", () => {
    expect(
      [
        "src/z.ts",
        "src/a.ts",
        "src/components/card.tsx",
        "src/components/alert.tsx",
      ].sort(compareScmPathsByTreeOrder),
    ).toEqual([
      "src/components/alert.tsx",
      "src/components/card.tsx",
      "src/a.ts",
      "src/z.ts",
    ]);
  });
});

describe("sortScmEntriesByTreeOrder", () => {
  test("sorts SCM entries by their tree path", () => {
    expect(sortScmEntriesByTreeOrder([entry("b.ts"), entry("a/x.ts"), entry("a/a.ts")])).toEqual(
      [entry("a/a.ts"), entry("a/x.ts"), entry("b.ts")],
    );
  });
});
