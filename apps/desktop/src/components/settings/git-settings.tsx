import { useSettingsStore, type BranchPrefixMode } from "@/state/settings-store";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

export default function GitSettings() {
  const branchPrefixMode = useSettingsStore((s) => s.branchPrefixMode);
  const branchPrefixCustom = useSettingsStore((s) => s.branchPrefixCustom);
  const deleteLocalBranchOnArchive = useSettingsStore((s) => s.deleteLocalBranchOnArchive);
  const archiveDeletesWorktree = useSettingsStore((s) => s.archiveDeletesWorktree);
  const archiveOnMerge = useSettingsStore((s) => s.archiveOnMerge);
  const setBranchPrefixMode = useSettingsStore((s) => s.setBranchPrefixMode);
  const setDeleteLocalBranchOnArchive = useSettingsStore((s) => s.setDeleteLocalBranchOnArchive);
  const setArchiveDeletesWorktree = useSettingsStore((s) => s.setArchiveDeletesWorktree);
  const setArchiveOnMerge = useSettingsStore((s) => s.setArchiveOnMerge);

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold text-[var(--theme-text)]">Git & Worktrees</h1>

      {/* Branch Name Prefix */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--theme-text)]">Branch name prefix</h2>
          <p className="mt-0.5 text-xs text-[var(--theme-text-subtle)]">
            Prefix for new workspace branch names.
          </p>
        </div>
        <div className="space-y-2 pl-1">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="branch-prefix" checked={branchPrefixMode === "github-username"} onChange={() => setBranchPrefixMode("github-username")} className="h-3.5 w-3.5 accent-[var(--theme-interactive)]" />
            <span className="text-sm text-[var(--theme-text)]">GitHub username (Maniktherana)</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="branch-prefix" checked={branchPrefixMode === "custom"} onChange={() => setBranchPrefixMode("custom", branchPrefixCustom)} className="h-3.5 w-3.5 accent-[var(--theme-interactive)]" />
            <span className="text-sm text-[var(--theme-text)]">Custom</span>
          </label>
          {branchPrefixMode === "custom" && (
            <Input placeholder="Enter prefix" value={branchPrefixCustom} onChange={(e) => setBranchPrefixMode("custom", e.target.value)} className="ml-7 w-56" />
          )}
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="branch-prefix" checked={branchPrefixMode === "none"} onChange={() => setBranchPrefixMode("none")} className="h-3.5 w-3.5 accent-[var(--theme-interactive)]" />
            <span className="text-sm text-[var(--theme-text)]">None</span>
          </label>
        </div>
      </section>

      {/* Delete worktree on archive */}
      <section className="border-t border-[var(--theme-border)] pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 pr-6">
            <h2 className="text-sm font-medium text-[var(--theme-text)]">Delete worktree on archive</h2>
            <p className="mt-0.5 text-xs text-[var(--theme-text-subtle)]">
              Permanently delete the git worktree folder when archiving. Cannot be undone.
            </p>
          </div>
          <Switch checked={archiveDeletesWorktree} onCheckedChange={setArchiveDeletesWorktree} />
        </div>
      </section>

      {/* Delete Branch on Archive */}
      <section className="border-t border-[var(--theme-border)] pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 pr-6">
            <h2 className="text-sm font-medium text-[var(--theme-text)]">Delete branch on archive</h2>
            <p className="mt-0.5 text-xs text-[var(--theme-text-subtle)]">
              Delete the local branch when archiving a workspace.
              To delete the remote branch, configure it on GitHub.
            </p>
          </div>
          <Switch checked={deleteLocalBranchOnArchive} onCheckedChange={setDeleteLocalBranchOnArchive} />
        </div>
      </section>

      {/* Archive on Merge */}
      <section className="border-t border-[var(--theme-border)] pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 pr-6">
            <h2 className="text-sm font-medium text-[var(--theme-text)]">Archive on merge</h2>
            <p className="mt-0.5 text-xs text-[var(--theme-text-subtle)]">
              Automatically archive a workspace after merging its PR.
            </p>
          </div>
          <Switch checked={archiveOnMerge} onCheckedChange={setArchiveOnMerge} />
        </div>
      </section>
    </div>
  );
}
