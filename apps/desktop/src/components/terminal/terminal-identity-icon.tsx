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

type IconMatcher = {
  pattern: RegExp;
  Icon: React.ComponentType<{ className?: string }>;
};

const ICON_MATCHERS: IconMatcher[] = [
  { pattern: /\bclaude(?:[- ]code)?\b/i, Icon: ClaudeCode },
  { pattern: /\bcodex\b/i, Icon: Codex },
  { pattern: /\bopencode\b/i, Icon: OpenCode },
  { pattern: /\bpi(?:[- ]agent)?\b/i, Icon: PiAgent },
  { pattern: /\bgemini(?:[- ]cli)?\b/i, Icon: Gemini },
  { pattern: /\bcursor[- ]agent\b/i, Icon: Cursor },
  { pattern: /\b(?:github[- ])?copilot\b/i, Icon: GitHubCopilot },
  { pattern: /\b(?:ampcode|amp[- ]code|amp)\b/i, Icon: AmpCode },
];

export default function TerminalIdentityIcon({
  identity,
  className,
}: {
  identity: TerminalDisplayState;
  className?: string;
}) {
  const cls = cn("shrink-0", className);

  for (const { pattern, Icon } of ICON_MATCHERS) {
    if (pattern.test(identity.label)) {
      return <Icon className={cls} aria-hidden />;
    }
  }

  return <TerminalSquare className={cls} aria-hidden />;
}
