import { useSettingsStore } from "@/state/settings-store";
import { Input } from "@/components/ui/input";

export default function GitSettings() {
  const branchPrefixMode = useSettingsStore((s) => s.branchPrefixMode);
  const branchPrefixCustom = useSettingsStore((s) => s.branchPrefixCustom);
  const setBranchPrefixMode = useSettingsStore((s) => s.setBranchPrefixMode);

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
            <input
              type="radio"
              name="branch-prefix"
              checked={branchPrefixMode === "github-username"}
              onChange={() => setBranchPrefixMode("github-username")}
              className="h-3.5 w-3.5 accent-[var(--theme-interactive)]"
            />
            <span className="text-sm text-[var(--theme-text)]">GitHub username</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="branch-prefix"
              checked={branchPrefixMode === "custom"}
              onChange={() => setBranchPrefixMode("custom", branchPrefixCustom)}
              className="h-3.5 w-3.5 accent-[var(--theme-interactive)]"
            />
            <span className="text-sm text-[var(--theme-text)]">Custom</span>
          </label>
          {branchPrefixMode === "custom" && (
            <Input
              placeholder="Enter prefix"
              value={branchPrefixCustom}
              onChange={(e) => setBranchPrefixMode("custom", e.target.value)}
              className="ml-7 w-56"
            />
          )}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="branch-prefix"
              checked={branchPrefixMode === "none"}
              onChange={() => setBranchPrefixMode("none")}
              className="h-3.5 w-3.5 accent-[var(--theme-interactive)]"
            />
            <span className="text-sm text-[var(--theme-text)]">None</span>
          </label>
        </div>
      </section>
    </div>
  );
}
