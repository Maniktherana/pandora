import {
  deriveChromeTiers,
  deriveCodeEditorTextTiers,
  derivePanelElevated,
  mergeScmTheme,
} from "../../theme";
import type {
  CodeEditorTheme,
  ReactUiTheme,
  ScmUiTheme,
  TerminalThemeColors,
  WorkspaceTheme,
} from "../../theme.types";
import codeEditor from "./code-editor.json";
import terminal from "./terminal.json";
import ui from "./ui.json";

type Oc2UiJson = Omit<
  ReactUiTheme,
  "borderSubtle" | "textMuted" | "textSubtle" | "textFaint" | "scm" | "panelElevated"
> & { scm?: Partial<ScmUiTheme> };

type Oc2CodeJson = Omit<CodeEditorTheme, "text"> & {
  text: Pick<CodeEditorTheme["text"], "primary">;
};

const oc2UiBase = ui as Oc2UiJson;
const oc2Chrome = deriveChromeTiers(oc2UiBase);

const oc2CodeBase = codeEditor as Oc2CodeJson;
const oc2CodeText = deriveCodeEditorTextTiers(oc2CodeBase.surface.base, oc2CodeBase.text.primary);

export const oc2CodeEditorTheme: CodeEditorTheme = {
  ...oc2CodeBase,
  text: {
    primary: oc2CodeBase.text.primary,
    ...oc2CodeText,
  },
};
export const oc2TerminalTheme: TerminalThemeColors = terminal;
export const oc2UiTheme: ReactUiTheme = {
  ...oc2UiBase,
  ...oc2Chrome,
  panelElevated: derivePanelElevated(oc2UiBase.panel),
  scm: mergeScmTheme(oc2UiBase, oc2UiBase.scm),
};

export const oc2Theme: WorkspaceTheme = {
  id: "oc-2",
  name: "OC-2",
  mode: "dark",
  ui: oc2UiTheme,
  codeEditor: oc2CodeEditorTheme,
  terminal: oc2TerminalTheme,
};
