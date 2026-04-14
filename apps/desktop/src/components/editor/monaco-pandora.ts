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
 * Heavy diagnostic/mode config only runs once; theme is always re-applied (cheap).
 */
let _diagnosticsConfigured = false;
export const pandoraMonacoBeforeMount: BeforeMount & DiffBeforeMount = (monaco) => {
  if (!_diagnosticsConfigured) {
    _diagnosticsConfigured = true;
    monaco.typescript.javascriptDefaults.setDiagnosticsOptions(noDiag);
    monaco.typescript.typescriptDefaults.setDiagnosticsOptions(noDiag);

    // Disable TS/JS language features that spin up workers (completions, semantic tokens, etc.)
    const tsNoFeatures = {
      completionItems: false,
      hovers: false,
      documentSymbols: false,
      definitions: false,
      references: false,
      documentHighlights: false,
      rename: false,
      diagnostics: false,
      documentRangeFormattingEdits: false,
      signatureHelp: false,
      onTypeFormattingEdits: false,
      codeActions: false,
      inlayHints: false,
    } as const;
    monaco.typescript.typescriptDefaults.setModeConfiguration(tsNoFeatures);
    monaco.typescript.javascriptDefaults.setModeConfiguration(tsNoFeatures);

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
  }

  registerPandoraMonacoTheme(monaco, defaultTheme);
};

/**
 * Read content directly from a Monaco model by file path.
 * Used by close-dirty-editor to get the latest content even if the debounced store sync hasn't fired.
 */
export function getMonacoModelContent(relativePath: string): string | undefined {
  const monaco = (globalThis as { monaco?: typeof import("monaco-editor") }).monaco;
  if (!monaco) return undefined;
  const uri = monaco.Uri.parse(relativePath);
  const model = monaco.editor.getModel(uri);
  return model?.getValue();
}
