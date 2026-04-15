import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "@/components/ui/input";
import type { ProjectRecord, ProjectSettings as ProjectSettingsType } from "@/lib/shared/types";
import ScriptEditorSection from "./script-editor-section";

interface ProjectSettingsProps {
  project: ProjectRecord;
}

function defaultSettings(projectId: string): ProjectSettingsType {
  return {
    projectId,
    defaultBranch: "",
    worktreeRoot: null,
    setupScripts: [],
    runScripts: [],
    teardownScripts: [],
    envVars: {},
    autoRunSetup: true,
  };
}

export default function ProjectSettings({ project }: ProjectSettingsProps) {
  const [settings, setSettings] = useState<ProjectSettingsType>(() => defaultSettings(project.id));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load settings on mount / project change
  useEffect(() => {
    let cancelled = false;
    invoke<ProjectSettingsType | null>("get_project_settings", { projectId: project.id })
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded ?? defaultSettings(project.id));
      })
      .catch(() => {
        if (cancelled) return;
        setSettings(defaultSettings(project.id));
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  // Debounced save
  const save = useCallback((next: ProjectSettingsType) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      invoke("save_project_settings", { settings: next }).catch(() => {});
    }, 600);
  }, []);

  const update = useCallback(
    (patch: Partial<ProjectSettingsType>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        save(next);
        return next;
      });
    },
    [save],
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold text-[var(--theme-text)]">Project Settings</h1>
        <p className="mt-0.5 text-xs text-[var(--theme-text-subtle)]">
          Per-repository settings and scripts.
        </p>
      </div>

      {/* Root path */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--theme-text)]">Root path</h2>
          <p className="mt-0.5 text-xs text-[var(--theme-text-subtle)]">
            Location of the main repository on disk.
          </p>
        </div>
        <span className="block text-xs font-mono text-[var(--theme-text-muted)]">
          {project.gitRootPath}
        </span>
      </section>

      {/* Configuration */}
      <section className="border-t border-[var(--theme-border)] pt-6 space-y-4">
        <div>
          <h2 className="text-sm font-medium text-[var(--theme-text)]">Worktree location</h2>
          <p className="mt-0.5 text-xs text-[var(--theme-text-subtle)]">
            New worktrees are stored as{" "}
            <span className="font-mono text-[var(--theme-text-muted)]">
              root/{project.displayName}/workspace
            </span>
            . Renaming a worktree also moves it to this layout.
          </p>
        </div>
        <Input
          value={settings.worktreeRoot ?? ""}
          onChange={(e) => {
            const val = (e.target as HTMLInputElement).value;
            update({ worktreeRoot: val || null });
          }}
          placeholder="~/workspaces"
          className="w-full max-w-md font-mono"
          size="sm"
        />
        <p className="text-xs text-[var(--theme-text-faint)]">Leave empty to use ~/workspaces.</p>
      </section>

      {/* Scripts */}
      <section className="border-t border-[var(--theme-border)] pt-6 space-y-3">
        <div>
          <h2 className="text-sm font-medium text-[var(--theme-text)]">Scripts</h2>
          <p className="mt-0.5 text-xs text-[var(--theme-text-subtle)]">
            Each row is a separate command, run in sequence.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {["$PANDORA_ROOT_PATH", "$PANDORA_WORKSPACE_NAME", "$PANDORA_WORKSPACE_PATH"].map((v) => (
            <span
              key={v}
              className="inline-flex items-center rounded-md bg-[var(--theme-panel-hover)] px-2 py-0.5 text-xs font-mono text-[var(--theme-text-subtle)]"
            >
              {v}
            </span>
          ))}
        </div>
      </section>

      {/* Setup */}
      <section className="border-t border-[var(--theme-border)] pt-6">
        <ScriptEditorSection
          title="Setup"
          description="Runs when a workspace is created."
          variant="simple"
          scripts={settings.setupScripts}
          onChange={(setupScripts) => update({ setupScripts })}
          autoRunToggle={{
            checked: settings.autoRunSetup,
            onChange: (v) => update({ autoRunSetup: v }),
          }}
        />
      </section>

      {/* Run */}
      <section className="border-t border-[var(--theme-border)] pt-6">
        <ScriptEditorSection
          title="Run"
          description="Runs when you click the play button."
          variant="named"
          scripts={settings.runScripts}
          onChange={(runScripts) => update({ runScripts })}
        />
      </section>

      {/* Teardown */}
      <section className="border-t border-[var(--theme-border)] pt-6">
        <ScriptEditorSection
          title="Teardown"
          description="Runs when a workspace is deleted."
          variant="simple"
          scripts={settings.teardownScripts}
          onChange={(teardownScripts) => update({ teardownScripts })}
        />
      </section>
    </div>
  );
}
