import type { BeforeMount, DiffBeforeMount, Monaco } from "@monaco-editor/react";
import { defaultTheme, toMonacoTheme } from "@/lib/theme";
import type { WorkspaceTheme } from "@/lib/theme";

export const MONACO_THEME_ID = "pandora-theme";

/** Editor chrome under Monaco; tracks `applyTheme` via `--theme-code-surface-base`. */
export const PANDORA_EDITOR_BG = "var(--theme-code-surface-base)";

export const PANDORA_EDITOR_FONT_FAMILY = defaultTheme.codeEditor.typography.fontFamily;
export const PANDORA_EDITOR_FONT_SIZE = defaultTheme.codeEditor.typography.fontSize;
export const PANDORA_EDITOR_LINE_HEIGHT = defaultTheme.codeEditor.typography.lineHeight;

const noDiag = {
  noSemanticValidation: true,
  noSyntaxValidation: true,
  noSuggestionDiagnostics: true,
} as const;

export function registerPandoraMonacoTheme(monaco: Monaco, workspaceTheme: WorkspaceTheme): void {
  monaco.editor.defineTheme(MONACO_THEME_ID, toMonacoTheme(workspaceTheme));
  monaco.editor.setTheme(MONACO_THEME_ID);
}

/**
 * Shared Monaco setup for the normal editor and the diff viewer (theme + quiet diagnostics).
 */
export const pandoraMonacoBeforeMount: BeforeMount & DiffBeforeMount = (monaco) => {
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions(noDiag);
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions(noDiag);

  const jd = monaco.json.jsonDefaults;
  jd.setDiagnosticsOptions({ validate: false });
  jd.setModeConfiguration({ ...jd.modeConfiguration, diagnostics: false });

  for (const d of [monaco.css.cssDefaults, monaco.css.scssDefaults, monaco.css.lessDefaults]) {
    d.setModeConfiguration({ ...d.modeConfiguration, diagnostics: false });
  }
  for (const d of [
    monaco.html.htmlDefaults,
    monaco.html.handlebarDefaults,
    monaco.html.razorDefaults,
  ]) {
    d.setModeConfiguration({ ...d.modeConfiguration, diagnostics: false });
  }

  registerPandoraMonacoTheme(monaco, defaultTheme);
};
