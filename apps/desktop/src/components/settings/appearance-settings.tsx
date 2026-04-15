import { useEffect, useState } from "react";
import {
  useSettingsStore,
  getFontFamily,
  getMonoFont,
  getTerminalFont,
  type FontOption,
  type MonoFontOption,
  type TerminalFontOption,
} from "@/state/settings-store";
import { applyTheme, themes } from "@/lib/theme";
import { cn } from "@/lib/shared/utils";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import EditorFontPreview from "./editor-font-preview";
import TerminalFontPreview from "./terminal-font-preview";

const UI_FONT_OPTIONS: { value: FontOption; label: string }[] = [
  { value: "system-default", label: "System Default" },
  { value: "sf-pro", label: "SF Pro Display" },
  { value: "inter", label: "Inter" },
  { value: "helvetica", label: "Helvetica Neue" },
  { value: "segoe-ui", label: "Segoe UI" },
  { value: "custom", label: "Custom" },
];

const MONO_FONT_OPTIONS: { value: MonoFontOption; label: string }[] = [
  { value: "jetbrains-mono", label: "JetBrains Mono" },
  { value: "fira-code", label: "Fira Code" },
  { value: "inconsolata", label: "Inconsolata" },
  { value: "source-code-pro", label: "Source Code Pro" },
  { value: "custom", label: "Custom" },
];

const TERMINAL_FONT_OPTIONS: { value: TerminalFontOption; label: string }[] = [
  { value: "jetbrains-nerd", label: "JetBrains Mono Nerd" },
  { value: "fira-code-nerd", label: "Fira Code Nerd" },
  { value: "menlo", label: "Menlo" },
  { value: "monaco", label: "Monaco" },
  { value: "custom", label: "Custom" },
];

function useSystemFonts() {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    if (!("queryLocalFonts" in window)) return;
    void (async () => {
      try {
        const localFonts =
          (await (
            window as Window & {
              queryLocalFonts?: () => Promise<Array<{ family: string }>>;
            }
          ).queryLocalFonts?.()) ?? [];
        const families = [...new Set(localFonts.map((font) => font.family))].sort((a, b) =>
          a.localeCompare(b, undefined, { sensitivity: "base" }),
        );
        setFonts(families);
      } catch {}
    })();
  }, []);
  return fonts;
}

function FontSizeStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0 rounded-md border border-[var(--theme-border)]">
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onChange(value - 1)}
        className="h-7 w-7 rounded-none rounded-l-md text-[var(--theme-text-subtle)]"
      >
        -
      </Button>
      <span className="flex h-7 w-10 items-center justify-center text-xs text-[var(--theme-text)] tabular-nums">
        {value}px
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onChange(value + 1)}
        className="h-7 w-7 rounded-none rounded-r-md text-[var(--theme-text-subtle)]"
      >
        +
      </Button>
    </div>
  );
}

function FontSelect({
  label,
  description,
  value,
  onValueChange,
  options,
  customValue,
  onCustomChange,
  systemFonts,
  fontSize,
  onFontSizeChange,
}: {
  label: string;
  description?: string;
  value: string;
  onValueChange: (val: string) => void;
  options: { value: string; label: string }[];
  customValue?: string;
  onCustomChange?: (val: string) => void;
  systemFonts?: string[];
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
}) {
  const isCustom = value === "custom";
  const hasSystemFonts = systemFonts && systemFonts.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium text-[var(--theme-text)]">{label}</h2>
          {description && <p className="text-xs text-[var(--theme-text-subtle)]">{description}</p>}
        </div>
        {fontSize != null && onFontSizeChange && (
          <FontSizeStepper value={fontSize} onChange={onFontSizeChange} />
        )}
      </div>
      <Select value={value} onValueChange={(nextValue) => onValueChange(String(nextValue))}>
        <SelectTrigger className="w-64 text-[var(--theme-text)]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isCustom && onCustomChange && (
        <>
          <Input
            placeholder="Font name as installed on your system"
            value={customValue ?? ""}
            onChange={(e) => onCustomChange(e.target.value)}
            className="w-64"
          />
          {hasSystemFonts && (
            <details className="text-xs text-[var(--theme-text-subtle)]">
              <summary className="cursor-pointer hover:text-[var(--theme-text)]">
                Browse installed fonts ({systemFonts.length})
              </summary>
              <div className="mt-1 max-h-40 overflow-y-auto rounded border border-[var(--theme-border)] bg-[var(--theme-panel)] p-1">
                {systemFonts.map((f) => (
                  <button
                    key={f}
                    onClick={() => onCustomChange(f)}
                    className={cn(
                      "block w-full rounded px-2 py-1 text-left text-xs hover:bg-[var(--theme-panel-hover)]",
                      customValue === f
                        ? "text-[var(--theme-text)]"
                        : "text-[var(--theme-text-subtle)]",
                    )}
                    style={{ fontFamily: f }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}

interface AppearanceSettingsProps {
  activeWorkspaceId: string | null;
  activeWorkspacePath: string | null;
}

export default function AppearanceSettings({
  activeWorkspaceId,
  activeWorkspacePath,
}: AppearanceSettingsProps) {
  const selectedThemeId = useSettingsStore((s) => s.selectedThemeId);
  const uiFontFamily = useSettingsStore((s) => s.uiFontFamily);
  const uiFontCustom = useSettingsStore((s) => s.uiFontCustom);
  const monoFontFamily = useSettingsStore((s) => s.monoFontFamily);
  const monoFontCustom = useSettingsStore((s) => s.monoFontCustom);
  const terminalFontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const terminalFontCustom = useSettingsStore((s) => s.terminalFontCustom);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setUiFont = useSettingsStore((s) => s.setUiFont);
  const setMonoFont = useSettingsStore((s) => s.setMonoFont);
  const setTerminalFont = useSettingsStore((s) => s.setTerminalFont);
  const setEditorFontSize = useSettingsStore((s) => s.setEditorFontSize);
  const setTerminalFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  const systemFonts = useSystemFonts();

  useEffect(() => {
    const theme = themes.find((t) => t.id === selectedThemeId);
    if (theme) applyTheme(theme);
  }, [selectedThemeId]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--theme-font-sans",
      getFontFamily(uiFontFamily, uiFontCustom),
    );
  }, [uiFontFamily, uiFontCustom]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--theme-font-mono",
      getMonoFont(monoFontFamily, monoFontCustom),
    );
    document.documentElement.style.setProperty("--theme-font-editor-size", `${editorFontSize}px`);
  }, [monoFontFamily, monoFontCustom, editorFontSize]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--theme-font-terminal",
      getTerminalFont(terminalFontFamily, terminalFontCustom),
    );
    document.documentElement.style.setProperty(
      "--theme-font-terminal-size",
      `${terminalFontSize}px`,
    );
  }, [terminalFontFamily, terminalFontCustom, terminalFontSize]);

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-semibold text-[var(--theme-text)]">Appearance</h1>

      {/* Theme */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--theme-text)]">Theme</h2>
        <div className="flex gap-2">
          {themes.map((theme) => (
            <button
              key={theme.id}
              onClick={() => setTheme(theme.id)}
              className={cn(
                "rounded-md border-2 px-6 py-2 text-sm font-medium transition-colors",
                selectedThemeId === theme.id
                  ? "border-[var(--theme-primary)] text-[var(--theme-text)]"
                  : "border-[var(--theme-border)] text-[var(--theme-text-subtle)] hover:border-[var(--theme-text-faint)]",
              )}
            >
              {theme.name === "OC-2" ? "Dark" : theme.name}
            </button>
          ))}
        </div>
      </section>

      {/* UI Font */}
      <section className="border-t border-[var(--theme-border)] pt-6">
        <FontSelect
          label="UI Font"
          value={uiFontFamily}
          onValueChange={(val) => setUiFont(val as FontOption)}
          options={UI_FONT_OPTIONS}
          customValue={uiFontCustom}
          onCustomChange={(val) => setUiFont("custom", val)}
          systemFonts={systemFonts}
        />
      </section>

      {/* Editor Font */}
      <section className="space-y-3 border-t border-[var(--theme-border)] pt-6">
        <FontSelect
          label="Editor Font"
          description="Font used for code editors and diffs."
          value={monoFontFamily}
          onValueChange={(val) => setMonoFont(val as MonoFontOption)}
          options={MONO_FONT_OPTIONS}
          customValue={monoFontCustom}
          onCustomChange={(val) => setMonoFont("custom", val)}
          systemFonts={systemFonts?.filter((f) =>
            /mono|code|consol|menlo|courier|fira|hack|iosevka|jetbrains|source|inconsolata/i.test(
              f,
            ),
          )}
          fontSize={editorFontSize}
          onFontSizeChange={setEditorFontSize}
        />
        <EditorFontPreview
          fontFamily={getMonoFont(monoFontFamily, monoFontCustom)}
          fontSize={editorFontSize}
        />
      </section>

      {/* Terminal Font */}
      <section className="space-y-3 border-t border-[var(--theme-border)] pt-6">
        <FontSelect
          label="Terminal Font"
          description="Font used in terminal panels. Nerd Fonts recommended for shell icons."
          value={terminalFontFamily}
          onValueChange={(val) => setTerminalFont(val as TerminalFontOption)}
          options={TERMINAL_FONT_OPTIONS}
          customValue={terminalFontCustom}
          onCustomChange={(val) => setTerminalFont("custom", val)}
          systemFonts={systemFonts?.filter((f) =>
            /mono|code|consol|menlo|courier|fira|hack|iosevka|jetbrains|source|nerd|term/i.test(f),
          )}
          fontSize={terminalFontSize}
          onFontSizeChange={setTerminalFontSize}
        />
        <TerminalFontPreview
          fontFamily={getTerminalFont(terminalFontFamily, terminalFontCustom)}
          activeWorkspaceId={activeWorkspaceId}
          activeWorkspacePath={activeWorkspacePath}
        />
      </section>
    </div>
  );
}
