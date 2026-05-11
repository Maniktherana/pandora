import type { SessionState, SlotState, TerminalDisplayState } from "@/lib/shared/shared.types";

const TERMINAL_LABEL = "Terminal";

const AUTO_TERMINAL_NAME = /^(?:local\s+terminal|terminal(?:\s+\d+)?)$/i;
const AUTO_SHELL_NAME = /^(zsh|bash|fish|sh|pwsh|powershell|shell)$/i;

const PRETTY_LABELS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bclaude(?:[- ]code)?\b/i, label: "Claude Code" },
  { pattern: /\bcodex\b/i, label: "Codex" },
  { pattern: /\bopencode\b/i, label: "OpenCode" },
  { pattern: /\bpi(?:[- ]agent)?\b/i, label: "Pi Agent" },
  { pattern: /\bgemini(?:[- ]cli)?\b/i, label: "Gemini CLI" },
  { pattern: /\bcursor[- ]agent\b/i, label: "Cursor Agent" },
  { pattern: /\b(?:github[- ])?copilot\b/i, label: "Copilot" },
  { pattern: /\b(?:ampcode|amp[- ]code|amp)\b/i, label: "Amp" },
];

function prettyLabel(name: string): string {
  for (const { pattern, label } of PRETTY_LABELS) {
    if (pattern.test(name)) return label;
  }
  return name;
}

export function detectTerminalDisplayFromProcess(
  processName: string | null | undefined,
): TerminalDisplayState | null {
  if (!processName) return null;
  if (AUTO_SHELL_NAME.test(processName)) return null;
  return { kind: "process", label: prettyLabel(processName) };
}

function customSlotLabel(slot: SlotState | undefined): string | null {
  const name = slot?.name?.trim();
  if (!name) return null;
  if (AUTO_TERMINAL_NAME.test(name) || AUTO_SHELL_NAME.test(name)) {
    return null;
  }
  return name;
}

function effectiveProcessName(session: SessionState | undefined): string | null {
  return session?.ptyForegroundProcess ?? null;
}

export function terminalDisplayForSlot(
  slot: SlotState | undefined,
  session: SessionState | undefined,
  detected: TerminalDisplayState | undefined,
): TerminalDisplayState {
  const customLabel = customSlotLabel(slot);
  const liveDetected = detectTerminalDisplayFromProcess(effectiveProcessName(session));
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

  // If the runtime says there's no live foreground app, don't resurrect a stale
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
