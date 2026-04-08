import type {
  SessionState,
  SlotState,
  TerminalDisplayKind,
  TerminalDisplayState,
} from "@/lib/shared/types";

const TERMINAL_LABEL = "Terminal";

const AUTO_TERMINAL_NAME = /^(?:local\s+terminal|terminal(?:\s+\d+)?)$/i;
const AUTO_SHELL_NAME = /^(zsh|bash|fish|sh|pwsh|powershell|shell)$/i;

type Detector = {
  kind: TerminalDisplayKind;
  label: string;
  pattern: RegExp;
};

const DETECTORS: Detector[] = [
  { kind: "claude-code", label: "Claude Code", pattern: /\bclaude(?:\s+code)?\b/i },
  { kind: "codex", label: "Codex", pattern: /\bcodex\b/i },
  { kind: "opencode", label: "OpenCode", pattern: /\bopencode\b/i },
  { kind: "pi-agent", label: "Pi Agent", pattern: /\bpi(?:[\s-]+agent)?\b/i },
  { kind: "gemini", label: "Gemini CLI", pattern: /\bgemini(?:\s+cli)?\b/i },
];

function detectTerminalDisplay(source: string): TerminalDisplayState | null {
  for (const detector of DETECTORS) {
    if (detector.pattern.test(source)) {
      return { kind: detector.kind, label: detector.label };
    }
  }
  return null;
}

export function detectTerminalDisplayFromProcess(
  foregroundProcess: string | null | undefined,
): TerminalDisplayState | null {
  if (!foregroundProcess) return null;
  return detectTerminalDisplay(foregroundProcess);
}

function customSlotLabel(slot: SlotState | undefined): string | null {
  const name = slot?.name?.trim();
  if (!name) return null;
  if (AUTO_TERMINAL_NAME.test(name) || AUTO_SHELL_NAME.test(name)) {
    return null;
  }
  return name;
}

export function terminalDisplayForSlot(
  slot: SlotState | undefined,
  session: SessionState | undefined,
  detected: TerminalDisplayState | undefined,
): TerminalDisplayState {
  const customLabel = customSlotLabel(slot);
  const liveDetected = detectTerminalDisplayFromProcess(session?.foregroundProcess);
  if (customLabel) {
    if (liveDetected && liveDetected.kind !== "terminal") {
      return { kind: liveDetected.kind, label: customLabel };
    }
    if (detected && detected.kind !== "terminal") {
      return { kind: detected.kind, label: customLabel };
    }
    return { kind: "terminal", label: customLabel };
  }
  if (liveDetected && liveDetected.kind !== "terminal") {
    return liveDetected;
  }

  // If the daemon says there's no live foreground app, don't resurrect a stale
  // regex-detected identity from earlier terminal input/output.
  if (session) {
    return { kind: "terminal", label: TERMINAL_LABEL };
  }

  if (detected && detected.kind !== "terminal") {
    return detected;
  }

  return detected ?? { kind: "terminal", label: TERMINAL_LABEL };
}

export function defaultTerminalDisplay(): TerminalDisplayState {
  return { kind: "terminal", label: TERMINAL_LABEL };
}
