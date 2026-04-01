export interface TerminalShellAppearance {
  kind: string;
  badge: string;
  label: string;
  className: string;
}

export function terminalShellAppearance(rawName: string | null | undefined): TerminalShellAppearance {
  const name = rawName?.toLowerCase() ?? "";

  if (name.includes("powershell") || name.includes("pwsh")) {
    return {
      kind: "pwsh",
      badge: "PS",
      label: "PowerShell",
      className: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
    };
  }
  if (name.includes("bash")) {
    return {
      kind: "bash",
      badge: "B",
      label: "bash",
      className: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
    };
  }
  if (name.includes("fish")) {
    return {
      kind: "fish",
      badge: "F",
      label: "fish",
      className: "bg-cyan-500/15 text-cyan-300 ring-cyan-500/30",
    };
  }
  if (name.includes("sh")) {
    return {
      kind: "sh",
      badge: "sh",
      label: "shell",
      className: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
    };
  }
  return {
    kind: "zsh",
    badge: "Z",
    label: "zsh",
    className: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  };
}
