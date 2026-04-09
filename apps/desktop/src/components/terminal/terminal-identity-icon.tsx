import { TerminalSquare } from "lucide-react";
import { ClaudeCode } from "@/components/icons/claude-code";
import { Codex } from "@/components/icons/codex";
import { Gemini } from "@/components/icons/gemini";
import { GitHubCopilot } from "@/components/icons/github-copilot";
import { OpenCode } from "@/components/icons/opencode";
import { PiAgent } from "@/components/icons/pi";
import { Cursor } from "@/components/icons/cursor";
import { AmpCode } from "@/components/icons/amp-code";
import type { TerminalDisplayState } from "@/lib/shared/types";
import { cn } from "@/lib/shared/utils";

export default function TerminalIdentityIcon({
  identity,
  className,
}: {
  identity: TerminalDisplayState;
  className?: string;
}) {
  switch (identity.kind) {
    case "claude-code":
      return <ClaudeCode className={cn("shrink-0", className)} aria-hidden />;
    case "codex":
      return <Codex className={cn("shrink-0", className)} aria-hidden />;
    case "opencode":
      return <OpenCode className={cn("shrink-0", className)} aria-hidden />;
    case "pi-agent":
      return <PiAgent className={cn("shrink-0", className)} aria-hidden />;
    case "gemini":
      return <Gemini className={cn("shrink-0", className)} aria-hidden />;
    case "cursor-agent":
      return <Cursor className={cn("shrink-0", className)} aria-hidden />;
    case "github-copilot":
      return <GitHubCopilot className={cn("shrink-0", className)} aria-hidden />;
    case "amp-code":
      return <AmpCode className={cn("shrink-0", className)} aria-hidden />;
    default:
      return <TerminalSquare className={cn("shrink-0", className)} aria-hidden />;
  }
}
