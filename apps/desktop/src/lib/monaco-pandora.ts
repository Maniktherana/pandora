import type { BeforeMount, DiffBeforeMount } from "@monaco-editor/react";
import { terminalTheme } from "@/lib/theme";

export const PANDORA_EDITOR_BG = terminalTheme.background ?? "#121212";

const noDiag = {
  noSemanticValidation: true,
  noSyntaxValidation: true,
  noSuggestionDiagnostics: true,
} as const;

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
  for (const d of [monaco.html.htmlDefaults, monaco.html.handlebarDefaults, monaco.html.razorDefaults]) {
    d.setModeConfiguration({ ...d.modeConfiguration, diagnostics: false });
  }

  monaco.editor.defineTheme("pandora-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": PANDORA_EDITOR_BG,
      "minimap.background": PANDORA_EDITOR_BG,
    },
  });
  monaco.editor.setTheme("pandora-dark");
};
