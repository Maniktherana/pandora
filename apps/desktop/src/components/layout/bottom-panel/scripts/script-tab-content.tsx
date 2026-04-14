import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectSettings } from "@/lib/shared/types";
import { ScriptEmptyState } from "./script-empty-state";

type ScriptTabContentProps = {
  scriptKind: "setup" | "run";
  projectId: string;
  onOpenSettings: () => void;
};

export function ScriptTabContent({ scriptKind, projectId, onOpenSettings }: ScriptTabContentProps) {
  const [hasScripts, setHasScripts] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<ProjectSettings | null>("get_project_settings", { projectId })
      .then((settings) => {
        if (cancelled) return;
        if (!settings) {
          setHasScripts(false);
          return;
        }
        if (scriptKind === "setup") {
          setHasScripts((settings.setupScripts?.length ?? 0) > 0);
        } else {
          setHasScripts((settings.runScripts?.length ?? 0) > 0);
        }
      })
      .catch(() => {
        if (!cancelled) setHasScripts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, scriptKind]);

  if (hasScripts === null) {
    return <div className="h-full bg-[var(--theme-bg)]" />;
  }

  if (!hasScripts) {
    return <ScriptEmptyState scriptKind={scriptKind} onOpenSettings={onOpenSettings} />;
  }

  // Placeholder for actual script execution UI (to be implemented later)
  return (
    <div className="flex h-full items-center justify-center text-xs text-[var(--theme-text-muted)]">
      {scriptKind === "setup" ? "Setup" : "Run"} scripts configured. Press play to execute.
    </div>
  );
}
