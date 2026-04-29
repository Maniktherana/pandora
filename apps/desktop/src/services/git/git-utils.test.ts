import { describe, expect, test } from "bun:test";
import {
  compareGitPathsByTreeOrder,
  optimisticallyStageAllEntries,
  optimisticallyStageEntries,
  optimisticallyUnstageAllEntries,
  optimisticallyUnstageEntries,
  sortGitEntriesByTreeOrder,
} from "@/services/git/git-utils";
import type { ScmEntry } from "@/lib/shared/types";

function entry(path: string, overrides: Partial<ScmEntry> = {}): ScmEntry {
  return {
    path,
    origPath: null,
    stagedKind: null,
    worktreeKind: "M",
    untracked: false,
    lineStats: { added: 0, removed: 0 },
    ...overrides,
  };
}

describe("compareGitPathsByTreeOrder", () => {
  test("matches file-tree ordering for nested folders and root files", () => {
    expect(
      ["zeta.ts", "src/app.ts", "src/components/button.tsx", "README.md"].sort(
        compareGitPathsByTreeOrder,
      ),
    ).toEqual(["src/components/button.tsx", "src/app.ts", "README.md", "zeta.ts"]);
  });

  test("keeps sibling files in name order within the same folder", () => {
    expect(
      ["src/z.ts", "src/a.ts", "src/components/card.tsx", "src/components/alert.tsx"].sort(
        compareGitPathsByTreeOrder,
      ),
    ).toEqual(["src/components/alert.tsx", "src/components/card.tsx", "src/a.ts", "src/z.ts"]);
  });
});

describe("sortGitEntriesByTreeOrder", () => {
  test("sorts git entries by their tree path", () => {
    expect(sortGitEntriesByTreeOrder([entry("b.ts"), entry("a/x.ts"), entry("a/a.ts")])).toEqual([
      entry("a/a.ts"),
      entry("a/x.ts"),
      entry("b.ts"),
    ]);
  });
});

describe("optimistic git status transforms", () => {
  test("stages tracked and untracked paths immediately", () => {
    expect(
      optimisticallyStageEntries(
        [
          entry("src/modified.ts"),
          entry("src/new.ts", { worktreeKind: "?", untracked: true }),
          entry("README.md"),
        ],
        ["src/modified.ts", "src/new.ts"],
      ),
    ).toEqual([
      entry("src/modified.ts", { stagedKind: "M", worktreeKind: null }),
      entry("src/new.ts", { stagedKind: "A", worktreeKind: null, untracked: false }),
      entry("README.md"),
    ]);
  });

  test("unstages modified and newly added paths immediately", () => {
    expect(
      optimisticallyUnstageEntries(
        [
          entry("src/modified.ts", { stagedKind: "M", worktreeKind: null }),
          entry("src/new.ts", { stagedKind: "A", worktreeKind: null }),
        ],
        ["src/modified.ts", "src/new.ts"],
      ),
    ).toEqual([
      entry("src/modified.ts", { stagedKind: null, worktreeKind: "M" }),
      entry("src/new.ts", { stagedKind: null, worktreeKind: "?", untracked: true }),
    ]);
  });

  test("stage all and unstage all only touch matching sides", () => {
    const current = [
      entry("staged.ts", { stagedKind: "M", worktreeKind: null }),
      entry("unstaged.ts"),
      entry("both.ts", { stagedKind: "M", worktreeKind: "M" }),
    ];

    expect(optimisticallyStageAllEntries(current)).toEqual([
      entry("both.ts", { stagedKind: "M", worktreeKind: null }),
      entry("staged.ts", { stagedKind: "M", worktreeKind: null }),
      entry("unstaged.ts", { stagedKind: "M", worktreeKind: null }),
    ]);

    expect(optimisticallyUnstageAllEntries(current)).toEqual([
      entry("both.ts", { stagedKind: null, worktreeKind: "M" }),
      entry("staged.ts", { stagedKind: null, worktreeKind: "M" }),
      entry("unstaged.ts"),
    ]);
  });
});
