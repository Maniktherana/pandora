import { invoke } from "@tauri-apps/api/core";
import type {
  PrContext,
  TerminalDisplayKind,
  WorkspaceRuntimeState,
} from "@/lib/shared/types";
import { findLeaf } from "@/lib/layout/layout-tree";
import { getAllLeaves } from "@/lib/layout/layout-tree";
import { terminalDisplayForSlot } from "@/lib/terminal/terminal-identity";

const AGENT_KINDS: TerminalDisplayKind[] = [
  "claude-code",
  "codex",
  "opencode",
  "pi-agent",
  "gemini",
];

export interface AgentTerminalTarget {
  slotId: string;
  sessionId: string;
  runtimeId: string;
}

/**
 * Find a running coding agent terminal in the workspace or project runtime.
 * Checks focused pane first, then all panes, then the bottom terminal panel.
 */
export function findAgentTerminal(
  workspaceRuntime: WorkspaceRuntimeState | null,
  projectRuntime: WorkspaceRuntimeState | null
): AgentTerminalTarget | null {
  for (const runtime of [workspaceRuntime, projectRuntime]) {
    if (!runtime) continue;

    const result = findAgentInRuntime(runtime);
    if (result) return result;
  }
  return null;
}

function findAgentInRuntime(
  runtime: WorkspaceRuntimeState
): AgentTerminalTarget | null {
  const { slots, terminalDisplayBySlotId, sessions, root, focusedPaneID } = runtime;

  const trySlotId = (slotId: string): AgentTerminalTarget | null => {
    const slot = slots.find((item) => item.id === slotId);
    const session = sessions.find(
      (s) => s.slotID === slotId && s.status === "running"
    );
    const display = terminalDisplayForSlot(slot, session, terminalDisplayBySlotId[slotId]);
    if (!display || !AGENT_KINDS.includes(display.kind)) return null;
    if (!session) return null;
    return {
      slotId,
      sessionId: session.id,
      runtimeId: runtime.workspaceId,
    };
  };

  // 1. Check focused pane
  if (root && focusedPaneID) {
    const focused = findLeaf(root, focusedPaneID);
    if (focused) {
      const activeTab = focused.tabs[focused.selectedIndex];
      if (activeTab?.kind === "terminal") {
        const result = trySlotId(activeTab.slotId);
        if (result) return result;
      }
    }
  }

  // 2. Search all panes
  if (root) {
    for (const leaf of getAllLeaves(root)) {
      for (const tab of leaf.tabs) {
        if (tab.kind === "terminal") {
          const result = trySlotId(tab.slotId);
          if (result) return result;
        }
      }
    }
  }

  // 3. Check terminal panel groups
  if (runtime.terminalPanel) {
    for (const group of runtime.terminalPanel.groups) {
      for (const slotId of group.children) {
        const result = trySlotId(slotId);
        if (result) return result;
      }
    }
  }

  return null;
}

export function composePrInstruction(ctx: PrContext, hasUncommittedChanges: boolean): string {
  const lines = [
    "Create a pull request for the current branch.",
    "",
    `Branch: ${ctx.branchName} -> ${ctx.baseBranch}`,
  ];

  if (ctx.commitLog) {
    lines.push("", "Commits:", ctx.commitLog);
  }

  if (ctx.diffStat) {
    lines.push("", "Diff summary:", ctx.diffStat);
  }

  lines.push("", "Instructions:");

  let step = 1;
  if (hasUncommittedChanges) {
    lines.push(`${step}. There are uncommitted changes — commit them first with an appropriate message`);
    step++;
  }
  lines.push(
    `${step}. Push the branch to origin if not already pushed`,
    `${step + 1}. Create a pull request using \`gh pr create\` targeting ${ctx.baseBranch}`,
    `${step + 2}. Write a clear title and description based on the changes above`,
    `${step + 3}. Report back the PR URL when done`
  );

  return lines.join("\n");
}

export async function gatherPrContext(
  workspaceId: string
): Promise<PrContext> {
  return invoke<PrContext>("pr_gather_context", { workspaceId });
}

export async function linkPr(
  workspaceId: string,
  prUrl: string,
  prNumber: number
): Promise<void> {
  return invoke("pr_link", { workspaceId, prUrl, prNumber });
}

export async function archiveWorkspace(workspaceId: string): Promise<void> {
  return invoke("archive_workspace", { workspaceId });
}

/**
 * Regex to detect GitHub PR URLs in terminal output.
 * Matches: https://github.com/owner/repo/pull/123
 */
export const PR_URL_PATTERN =
  /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/;

export function extractPrFromOutput(
  text: string
): { url: string; number: number } | null {
  const match = text.match(PR_URL_PATTERN);
  if (!match) return null;
  return { url: match[0], number: parseInt(match[1], 10) };
}
