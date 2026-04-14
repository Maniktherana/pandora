import { Button } from "@/components/ui/button";

type ScriptEmptyStateProps = {
  scriptKind: "setup" | "run";
  onOpenSettings: () => void;
};

export function ScriptEmptyState({ scriptKind, onOpenSettings }: ScriptEmptyStateProps) {
  const label = scriptKind === "setup" ? "setup" : "run";

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm font-medium text-[var(--theme-text)]">
        No {label} script configured
      </p>
      <p className="max-w-sm text-xs text-[var(--theme-text-muted)]">
        Configure a {label} script in Project Settings.
      </p>
      <Button variant="outline" size="sm" onClick={onOpenSettings}>
        Configure {label} script
      </Button>
    </div>
  );
}
