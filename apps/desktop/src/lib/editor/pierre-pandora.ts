import type { CSSProperties } from "react";
import {
  registerCustomTheme,
  type FileContents,
  type FileDiffOptions,
} from "@pierre/diffs";
import { oc2CodeSurfaceTokens, toPierreVariables } from "@/lib/theme/oc2";

const PANDORA_PIERRE_THEME = "pandora-oc2";

let pierreThemeRegistered = false;

function registerPandoraPierreTheme() {
  if (pierreThemeRegistered) return;
  pierreThemeRegistered = true;

  registerCustomTheme(PANDORA_PIERRE_THEME, () =>
    Promise.resolve({
      name: PANDORA_PIERRE_THEME,
      colors: {
        "editor.background": "var(--oc-code-surface-base)",
        "editor.foreground": "var(--oc-code-text-primary)",
      },
      tokenColors: [
        {
          scope: ["comment", "punctuation.definition.comment", "string.comment"],
          settings: { foreground: "var(--oc-syntax-comment)" },
        },
        {
          scope: "keyword",
          settings: { foreground: "var(--oc-syntax-keyword)" },
        },
        {
          scope: [
            "keyword.operator",
            "storage.type.function.arrow",
            "punctuation.separator.key-value.css",
          ],
          settings: { foreground: "var(--oc-syntax-operator)" },
        },
        {
          scope: ["string", "punctuation.definition.string"],
          settings: { foreground: "var(--oc-syntax-string)" },
        },
        {
          scope: ["constant", "entity.name.constant", "variable.language"],
          settings: { foreground: "var(--oc-syntax-constant)" },
        },
        {
          scope: ["entity.name.function", "support.type.primitive", "support"],
          settings: { foreground: "var(--oc-syntax-primitive)" },
        },
        {
          scope: ["entity.other.attribute-name", "meta.property-name"],
          settings: { foreground: "var(--oc-syntax-property)" },
        },
        {
          scope: ["entity.name", "support.class.component", "type", "storage.type"],
          settings: { foreground: "var(--oc-syntax-type)" },
        },
        {
          scope: "variable",
          settings: { foreground: "var(--oc-syntax-variable)" },
        },
        {
          scope: ["meta.block", "meta.embedded.expression", "punctuation"],
          settings: { foreground: "var(--oc-syntax-punctuation)" },
        },
      ],
    })
  );
}

registerPandoraPierreTheme();

export const pierreSurfaceStyle = toPierreVariables(oc2CodeSurfaceTokens);

const pierreUnsafeCSS = `
[data-diff],
[data-file] {
  --diffs-bg: var(--oc-code-surface-base);
  --diffs-bg-buffer: color-mix(in srgb, var(--oc-code-surface-base) 74%, var(--oc-code-surface-separator));
  --diffs-hatch-line: color-mix(in srgb, var(--diffs-bg-buffer) 52%, var(--oc-code-surface-separator));
  --diffs-bg-hover: var(--oc-code-surface-hover);
  --diffs-bg-context: var(--oc-code-surface-base);
  --diffs-bg-separator: var(--oc-code-surface-chrome);
  --diffs-fg: var(--oc-code-text-primary);
  --diffs-fg-number: var(--oc-code-text-line-number);
  --diffs-fg-number-addition-override: var(--oc-code-diff-add-base);
  --diffs-fg-number-deletion-override: var(--oc-code-diff-delete-base);
  --diffs-deletion-base: var(--oc-code-diff-delete-base);
  --diffs-addition-base: var(--oc-code-diff-add-base);
  --diffs-modified-base: var(--oc-code-diff-modified-base);
  --diffs-bg-deletion: var(--oc-code-diff-delete-fill);
  --diffs-bg-deletion-number: color-mix(in srgb, var(--oc-code-diff-delete-base) 20%, var(--oc-code-surface-base));
  --diffs-bg-deletion-hover: color-mix(in srgb, var(--oc-code-diff-delete-base) 28%, var(--oc-code-surface-base));
  --diffs-bg-deletion-emphasis: var(--oc-code-diff-delete-fill-strong);
  --diffs-bg-addition: var(--oc-code-diff-add-fill);
  --diffs-bg-addition-number: color-mix(in srgb, var(--oc-code-diff-add-base) 18%, var(--oc-code-surface-base));
  --diffs-bg-addition-hover: color-mix(in srgb, var(--oc-code-diff-add-base) 26%, var(--oc-code-surface-base));
  --diffs-bg-addition-emphasis: var(--oc-code-diff-add-fill-strong);
  --diffs-selection-border: var(--oc-primary);
  --diffs-bg-selection: color-mix(in srgb, var(--oc-code-selection) 72%, transparent);
  --diffs-bg-selection-number: color-mix(in srgb, var(--oc-code-selection) 92%, transparent);
  --diffs-bg-selection-text: color-mix(in srgb, var(--oc-code-selection) 35%, transparent);
  --diffs-selection-number-fg: var(--oc-code-text-primary);
  --diffs-font-family: ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  --diffs-font-size: 13px;
  --diffs-line-height: 24px;
  --diffs-tab-size: 2;
  --diffs-gap-block: 0;
  --diffs-min-number-column-width: 4ch;
}

[data-diff-header],
[data-diff],
[data-file] {
  background: var(--oc-code-surface-base);
  color: var(--oc-code-text-primary);
}

[data-diff] [data-line],
[data-file] [data-line] {
  transition: background-color 120ms ease;
}

[data-diff][data-indicators='bars'] [data-line-type='change-deletion'][data-column-number]::before {
  background-image: linear-gradient(
    0deg,
    var(--diffs-bg-deletion) 50%,
    var(--oc-code-gutter-delete) 50%
  ) !important;
  background-repeat: repeat !important;
  background-size: calc(1lh / round(1lh / 2px)) calc(1lh / round(1lh / 2px)) !important;
}

[data-diff][data-indicators='bars'] [data-line-type='change-addition'][data-column-number]::before {
  background: var(--oc-code-gutter-add) !important;
}

[data-diff] [data-column-number],
[data-file] [data-column-number] {
  background: var(--oc-code-surface-base);
  color: var(--oc-code-text-line-number);
}

[data-diff][data-background] [data-line-type='change-addition'][data-column-number] {
  background-color: color-mix(in srgb, var(--oc-code-diff-add-base) 15%, var(--oc-code-surface-base));
  color: var(--oc-code-diff-add-base);
}

[data-diff][data-background] [data-line-type='change-deletion'][data-column-number] {
  background-color: color-mix(in srgb, var(--oc-code-diff-delete-base) 14%, var(--oc-code-surface-base));
  color: var(--oc-code-diff-delete-base);
}

[data-diff] [data-separator],
[data-file] [data-separator] {
  background: var(--oc-code-surface-chrome);
  border-top: 1px solid var(--oc-code-surface-separator);
  border-bottom: 1px solid var(--oc-code-surface-separator);
}

[data-diff] [data-line-type='context-expanded'] {
  background: color-mix(in srgb, var(--oc-code-surface-chrome) 72%, transparent);
}

[data-diff] [data-line][data-selected-line],
[data-file] [data-line][data-selected-line] {
  box-shadow: inset 2px 0 0 var(--diffs-selection-border);
}

[data-diff] [data-code],
[data-file] [data-code] {
  overflow-x: auto !important;
  overflow-y: hidden !important;
}

/* Pierre defaults: 8×8px tile, 3–4px stops. Stronger scale for legibility. */
[data-diff] [data-content-buffer],
[data-file] [data-content-buffer] {
  background-size: 15px 15px !important;
  background-position: 9px 0 !important;
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent calc(6px * 1.414),
    var(--diffs-hatch-line) calc(6px * 1.414),
    var(--diffs-hatch-line) calc(8px * 1.414)
  ) !important;
}

[data-diff] [data-gutter-buffer='buffer'],
[data-file] [data-gutter-buffer='buffer'] {
  background-size: 15px 15px !important;
  background-image: repeating-linear-gradient(
    -45deg,
    transparent,
    transparent calc(6px * 1.414),
    rgb(from var(--diffs-hatch-line) r g b / 0.8) calc(6px * 1.414),
    rgb(from var(--diffs-hatch-line) r g b / 0.8) calc(8px * 1.414)
  ) !important;
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
