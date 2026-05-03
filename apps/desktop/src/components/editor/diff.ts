import { createElement, type CSSProperties, type ReactNode } from "react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url";
import {
  registerCustomTheme,
  type FileContents,
  type FileDiffOptions,
  type VirtualFileMetrics,
} from "@pierre/diffs";
import { toDiffVariables } from "@/lib/shared/theme";
import { defaultTheme } from "@/lib/shared/theme";
import { hashDiffText } from "@/lib/shared/hash";

const DIFF_THEME = "pandora-theme";
const REVIEW_DIFF_LINE_HEIGHT = defaultTheme.codeEditor.typography.lineHeight;
const syntax = defaultTheme.codeEditor.syntax;
const codeSurface = defaultTheme.codeEditor.surface;

let diffThemeRegistered = false;

const diffWorkerFactory = () => new Worker(DiffWorkerUrl, { type: "module" });
const diffWorkerPoolOptions = { workerFactory: diffWorkerFactory, poolSize: 1 };
const diffHighlighterOptions = { theme: DIFF_THEME };

function registerDiffTheme() {
  if (diffThemeRegistered) return;
  diffThemeRegistered = true;

  registerCustomTheme(DIFF_THEME, () =>
    Promise.resolve({
      name: DIFF_THEME,
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
    }),
  );
}

registerDiffTheme();

export const diffSurfaceStyle = toDiffVariables(defaultTheme.codeEditor);

export const REVIEW_DIFF_METRICS: VirtualFileMetrics = {
  hunkLineCount: 50,
  lineHeight: REVIEW_DIFF_LINE_HEIGHT,
  diffHeaderHeight: 0,
  hunkSeparatorHeight: 32,
  fileGap: 8,
};

const diffUnsafeCSS = `
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

type DiffStyle = NonNullable<FileDiffOptions<unknown>["diffStyle"]>;

export function createDiffOptions(
  diffStyle: DiffStyle,
  wrapLines: boolean,
): FileDiffOptions<unknown> {
  return {
    theme: DIFF_THEME,
    themeType: "dark",
    disableLineNumbers: false,
    overflow: wrapLines ? "wrap" : "scroll",
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
    unsafeCSS: diffUnsafeCSS,
  };
}

export function createDiffFile(name: string, contents: string): FileContents {
  return {
    name,
    contents,
    cacheKey: `${name}:${contents.length}:${hashDiffText(contents)}`,
  };
}

export function getLargeDiffOptions(diffStyle: DiffStyle): Partial<FileDiffOptions<unknown>> {
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

export function getDiffSurfaceStyle(): CSSProperties {
  return diffSurfaceStyle;
}

export function DiffWorkerPoolProvider({ children }: { children: ReactNode }) {
  return createElement(
    WorkerPoolContextProvider,
    {
      poolOptions: diffWorkerPoolOptions,
      highlighterOptions: diffHighlighterOptions,
      children,
    },
  );
}
