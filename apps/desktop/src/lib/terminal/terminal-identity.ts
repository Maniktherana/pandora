import type { SlotState, TerminalDisplayKind, TerminalDisplayState } from "@/lib/shared/types";

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

const pendingInputBySessionId = new Map<string, string>();

function detectTerminalDisplay(source: string): TerminalDisplayState | null {
  for (const detector of DETECTORS) {
    if (detector.pattern.test(source)) {
      return { kind: detector.kind, label: detector.label };
    }
  }
  return null;
}

export function detectTerminalDisplayFromOutput(data: string): TerminalDisplayState | null {
  return detectTerminalDisplay(data);
}

export function detectTerminalDisplayFromInput(
  sessionID: string,
  data: string
): TerminalDisplayState | null {
  let buffer = pendingInputBySessionId.get(sessionID) ?? "";

  for (const char of data) {
    if (char === "\u0003") {
      buffer = "";
      continue;
    }
    if (char === "\u007f" || char === "\b") {
      buffer = buffer.slice(0, -1);
      continue;
    }
    if (char === "\r" || char === "\n") {
      const line = buffer.trim();
      buffer = "";
      if (!line) continue;
      const command = line
        .split(/[|;&]/, 1)[0]
        ?.trim()
        .split(/\s+/, 1)[0]
        ?.replace(/^exec\s+/i, "")
        .trim();
      if (!command) continue;
      const detected = detectTerminalDisplay(command);
      if (detected) {
        pendingInputBySessionId.delete(sessionID);
        return detected;
      }
      continue;
    }
    if (char >= " " && char !== "\u001b") {
      buffer += char;
    }
  }

  pendingInputBySessionId.set(sessionID, buffer.slice(-256));
  return null;
}

export function resetTerminalInputTracking(sessionID: string): void {
  pendingInputBySessionId.delete(sessionID);
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
  detected: TerminalDisplayState | undefined
): TerminalDisplayState {
  if (detected && detected.kind !== "terminal") {
    return detected;
  }

  const customLabel = customSlotLabel(slot);
  if (customLabel) {
    return { kind: "terminal", label: customLabel };
  }

  return detected ?? { kind: "terminal", label: TERMINAL_LABEL };
}

export function defaultTerminalDisplay(): TerminalDisplayState {
  return { kind: "terminal", label: TERMINAL_LABEL };
}
