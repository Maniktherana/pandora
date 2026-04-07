import type { CSSProperties } from "react";
import {
  registerCustomTheme,
  type FileContents,
  type FileDiffOptions,
} from "@pierre/diffs";
import { toPierreVariables } from "@/lib/theme";
import { defaultTheme } from "@/lib/theme";

const PANDORA_PIERRE_THEME = "pandora-theme";
const syntax = defaultTheme.codeEditor.syntax;
const codeSurface = defaultTheme.codeEditor.surface;

let pierreThemeRegistered = false;

function registerPandoraPierreTheme() {
  if (pierreThemeRegistered) return;
  pierreThemeRegistered = true;

  registerCustomTheme(PANDORA_PIERRE_THEME, () =>
    Promise.resolve({
      name: PANDORA_PIERRE_THEME,
      colors: {
        "editor.background": codeSurface.base,
        "editor.foreground": defaultTheme.codeEditor.text.primary,
      },
      tokenColors: [
        {
          scope: ["comment", "punctuation.definition.comment", "string.comment"],
          settings: { foreground: syntax.comment },
        },
        {
          scope: "keyword",
          settings: { foreground: syntax.keyword },
        },
        {
          scope: [
            "keyword.operator",
            "storage.type.function.arrow",
            "punctuation.separator.key-value.css",
          ],
          settings: { foreground: syntax.operator },
        },
        {
          scope: ["string", "punctuation.definition.string"],
          settings: { foreground: syntax.string },
        },
        {
          scope: ["constant", "entity.name.constant", "variable.language"],
          settings: { foreground: syntax.constant },
        },
        {
          scope: ["entity.name.function", "support.type.primitive", "support"],
          settings: { foreground: syntax.primitive },
        },
        {
          scope: ["entity.other.attribute-name", "meta.property-name"],
          settings: { foreground: syntax.property },
        },
        {
          scope: ["entity.name", "support.class.component", "type", "storage.type"],
          settings: { foreground: syntax.type },
        },
        {
          scope: "variable",
          settings: { foreground: syntax.variable },
        },
        {
          scope: ["meta.block", "meta.embedded.expression", "punctuation"],
          settings: { foreground: syntax.punctuation },
        },
      ],
    })
  );
}

registerPandoraPierreTheme();

export const pierreSurfaceStyle = toPierreVariables(defaultTheme.codeEditor);

const pierreUnsafeCSS = `
[data-diff] [data-column-number],
[data-file] [data-column-number] {
  background: var(--theme-code-surface-base) !important;
  color: var(--theme-code-text-line-number) !important;
  border-right: 1px solid var(--theme-code-surface-separator);
}

/* Split view center divider: code column (left) -> number column (right) */
[data-diff] [data-code] + [data-column-number],
[data-file] [data-code] + [data-column-number] {
  border-left: 1px solid var(--theme-code-surface-separator);
}

[data-diff][data-background] [data-line-type='change-addition'][data-column-number] {
  background: var(--theme-code-surface-base) !important;
  color: var(--theme-code-diff-add-base) !important;
}

[data-diff][data-background] [data-line-type='change-deletion'][data-column-number] {
  background: var(--theme-code-surface-base) !important;
  color: var(--theme-code-diff-delete-base) !important;
}

`;

type PierreDiffStyle = NonNullable<FileDiffOptions<unknown>["diffStyle"]>;

export function createPierreDiffOptions(diffStyle: PierreDiffStyle): FileDiffOptions<unknown> {
  return {
    theme: PANDORA_PIERRE_THEME,
    themeType: "dark",
    disableLineNumbers: false,
    overflow: "wrap",
    diffStyle,
    diffIndicators: "bars",
    disableBackground: false,
    hunkSeparators: "line-info-basic",
    expansionLineCount: 20,
    lineDiffType: diffStyle === "split" ? "word-alt" : "none",
    maxLineDiffLength: 1000,
    tokenizeMaxLineLength: 1000,
    disableFileHeader: true,
    lineHoverHighlight: "both",
    unsafeCSS: pierreUnsafeCSS,
  };
}

export function createPierreFile(name: string, contents: string): FileContents {
  return {
    name,
    contents,
    cacheKey: `${name}:${contents.length}:${contents.slice(0, 128)}`,
  };
}

export function getLargeDiffOptions(diffStyle: PierreDiffStyle): Partial<FileDiffOptions<unknown>> {
  if (diffStyle !== "split") {
    return {
      lineDiffType: "none",
      maxLineDiffLength: 0,
      tokenizeMaxLineLength: 1,
    };
  }

  return {
    lineDiffType: "none",
    maxLineDiffLength: 0,
    tokenizeMaxLineLength: 1,
  };
}

export function getPierreSurfaceStyle(): CSSProperties {
  return pierreSurfaceStyle;
}
