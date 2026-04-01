import { useCallback, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { Plus, SplitSquareHorizontal } from "lucide-react";
import { useWorkspaceStore } from "@/stores/workspace-store";
import BottomTerminalPanelView from "@/components/BottomTerminalPanelView";
import { getTerminalDaemonClient } from "@/lib/terminal-runtime";
import { projectRuntimeKey } from "@/lib/runtime-keys";
import { seedProjectTerminal } from "@/lib/terminal-seed";
import { cn } from "@/lib/utils";
import type { SessionState } from "@/lib/types";

type BottomTab = "terminal" | "ports";

function clampPort(n: number): number | null {
  if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
  return Math.floor(n);
}

function parseUserPort(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const hostPort = t.match(/^[\w.-]+:(\d{1,5})$/);
  if (hostPort) return clampPort(Number(hostPort[1]));
  if (/^\d{1,5}$/.test(t)) return clampPort(Number(t));
  return null;
}

function PortDataRow({
  port,
  process,
  origin,
  onRemove,
}: {
  port: number;
  process: string;
  origin: string;
  onRemove?: () => void;
}) {
  const addr = `localhost:${port}`;
  return (
    <tr className="border-b border-neutral-800/80">
      <td className="px-3 py-2 font-mono tabular-nums">{port}</td>
      <td className="py-2">
        <button
          type="button"
          className="text-left text-blue-400 hover:text-blue-300 hover:underline"
          onClick={() => {
            const url = `http://127.0.0.1:${port}`;
            void open(url).catch(() => window.open(url, "_blank"));
          }}
        >
          {addr}
        </button>
      </td>
      <td className="max-w-[220px] truncate py-2 text-neutral-300" title={process}>
        {process}
      </td>
      <td className="py-2 pr-3">
        <span className="text-neutral-500">{origin}</span>
        {onRemove && (
          <button
            type="button"
            className="ml-2 text-xs text-neutral-500 hover:text-neutral-300"
            onClick={onRemove}
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}

function PortsTabContent({
  projectSessions,
  workspaceSessions,
}: {
  projectSessions: SessionState[];
  workspaceSessions: SessionState[];
}) {
  const [manual, setManual] = useState<{ id: string; port: number }[]>([]);
  const [forwardUiOpen, setForwardUiOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const sessionRows = useMemo(() => {
    const map = new Map<number, { port: number; process: string; origin: string }>();
    const add = (s: SessionState, origin: string) => {
      if (s.port == null || s.port <= 0) return;
      if (!map.has(s.port)) map.set(s.port, { port: s.port, process: s.name, origin });
    };
    projectSessions.forEach((s) => add(s, "Project"));
    workspaceSessions.forEach((s) => add(s, "Workspace"));
    return Array.from(map.values()).sort((a, b) => a.port - b.port);
  }, [projectSessions, workspaceSessions]);

  const hasAnyRows = sessionRows.length > 0 || manual.length > 0;
  const showTable = hasAnyRows || forwardUiOpen;

  const addManual = () => {
    const p = parseUserPort(draft);
    if (p == null) return;
    const exists =
      sessionRows.some((r) => r.port === p) || manual.some((m) => m.port === p);
    if (exists) {
      setDraft("");
      return;
    }
    setManual((prev) => [...prev, { id: crypto.randomUUID(), port: p }]);
    setDraft("");
  };

  if (!showTable) {
    return (
      <div className="px-4 py-5">
        <p className="mb-4 max-w-lg text-sm text-neutral-400">
          No forwarded ports. Forward a port to access your locally running services over the internet.
        </p>
        <button
          type="button"
          onClick={() => setForwardUiOpen(true)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Forward a Port
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2 font-medium">Port</th>
              <th className="py-2 font-medium">Forwarded Address</th>
              <th className="py-2 font-medium">Running Process</th>
              <th className="py-2 pr-3 font-medium">Origin</th>
            </tr>
          </thead>
          <tbody className="text-neutral-300">
            {forwardUiOpen && (
              <tr className="border-b border-neutral-800/80 bg-neutral-900/40">
                <td className="px-3 py-2 align-middle">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addManual();
                    }}
                    placeholder="Port number or address (e.g. 3000 or localhost:3000)"
                    className="w-full min-w-[200px] rounded border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-xs text-neutral-200 placeholder:text-neutral-600"
                  />
                </td>
                <td className="py-2 align-middle text-neutral-600">—</td>
                <td className="py-2 align-middle text-neutral-600">—</td>
                <td className="py-2 pr-3 align-middle">
                  <button
                    type="button"
                    onClick={addManual}
                    className="text-xs font-medium text-blue-400 hover:text-blue-300"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setForwardUiOpen(false);
                      setDraft("");
                    }}
                    className="ml-3 text-xs text-neutral-500 hover:text-neutral-300"
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            )}
            {sessionRows.map((r) => (
              <PortDataRow key={`s-${r.port}`} port={r.port} process={r.process} origin={r.origin} />
            ))}
            {manual.map((m) => (
              <PortDataRow
                key={m.id}
                port={m.port}
                process="—"
                origin="Forwarded"
                onRemove={() => setManual((prev) => prev.filter((x) => x.id !== m.id))}
              />
            ))}
          </tbody>
        </table>
      </div>
      {hasAnyRows && (
        <div className="shrink-0 border-t border-neutral-800 px-3 py-2">
          <button
            type="button"
            onClick={() => setForwardUiOpen(true)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            Forward a Port
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Bottom strip: project terminal (git root) with right sidebar tabs; Ports like VS Code.
 */
export default function BottomPanel() {
  const [tab, setTab] = useState<BottomTab>("terminal");
  const project = useWorkspaceStore((s) => s.selectedProject());
  const selectedWs = useWorkspaceStore((s) => s.selectedWorkspace());
  const workspaceRuntime = useWorkspaceStore((s) =>
    s.selectedWorkspaceID ? s.runtimes[s.selectedWorkspaceID] : null
  );
  const projectKey = project ? projectRuntimeKey(project.id) : "";
  const projectRuntime = useWorkspaceStore((s) => (projectKey ? s.runtimes[projectKey] : null));
  const addProjectTerminalGroup = useWorkspaceStore((s) => s.addProjectTerminalGroup);
  const splitProjectTerminalGroup = useWorkspaceStore((s) => s.splitProjectTerminalGroup);
  const setProjectTerminalPanelVisible = useWorkspaceStore((s) => s.setProjectTerminalPanelVisible);

  const addProjectTerminal = useCallback(() => {
    const client = getTerminalDaemonClient();
    if (!client || !projectKey) return;
    const seeded = seedProjectTerminal(client, projectKey);
    addProjectTerminalGroup(projectKey, seeded.slotID);
  }, [addProjectTerminalGroup, projectKey]);

  const splitActiveGroup = useCallback(() => {
    const client = getTerminalDaemonClient();
    const activeGroup =
      projectRuntime?.terminalPanel?.groups[projectRuntime.terminalPanel.activeGroupIndex] ?? null;
    if (!client || !projectKey || !activeGroup) return;
    const seeded = seedProjectTerminal(client, projectKey);
    splitProjectTerminalGroup(projectKey, activeGroup.id, seeded.slotID);
  }, [projectKey, projectRuntime?.terminalPanel, splitProjectTerminalGroup]);

  if (!project || selectedWs?.status !== "ready") {
    return <div className="h-full min-h-[120px] bg-neutral-950" />;
  }

  if (!projectRuntime) {
    return (
      <div className="flex h-full min-h-[120px] items-center justify-center border-t border-neutral-800 bg-neutral-950 text-sm text-neutral-500">
        Starting project shell…
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col border-t border-neutral-800 bg-neutral-950"
      onPointerDownCapture={() => {
        useWorkspaceStore.getState().setLayoutTargetRuntimeId(projectKey);
      }}
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-800 px-2">
        {(["terminal", "ports"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              if (id === "terminal") {
                setProjectTerminalPanelVisible(projectKey, true);
                if ((projectRuntime.terminalPanel?.groups.length ?? 0) === 0) {
                  addProjectTerminal();
                }
              }
            }}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              tab === id
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-500 hover:bg-neutral-800/80 hover:text-neutral-300"
            )}
          >
            {id === "terminal" ? "Terminal" : "Ports"}
          </button>
        ))}
        {tab === "terminal" && (
          <span
            className="ml-1 truncate text-[10px] text-neutral-500"
            title="Shared shell at the git repository root (separate from the worktree checkout above)."
          >
            · git root
          </span>
        )}
        {tab === "terminal" && (
          <button
            type="button"
            title="New project terminal"
            onClick={addProjectTerminal}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
        {tab === "terminal" && (
          <button
            type="button"
            title="Split active terminal group"
            onClick={splitActiveGroup}
            disabled={(projectRuntime.terminalPanel?.groups.length ?? 0) === 0}
            className="flex h-7 w-7 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SplitSquareHorizontal className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "terminal" ? (
          <BottomTerminalPanelView workspaceId={projectKey} runtime={projectRuntime} />
        ) : (
          <PortsTabContent
            projectSessions={projectRuntime?.sessions ?? []}
            workspaceSessions={workspaceRuntime?.sessions ?? []}
          />
        )}
      </div>
    </div>
  );
}
