import { useMemo, useState } from "react";
import { PortDataRow } from "./port-data-row";
import type { SessionState } from "@/lib/shared/types";
import { parseUserPort } from "../bottom-panel.utils";

type PortsTabContentProps = {
  projectSessions: SessionState[];
  workspaceSessions: SessionState[];
};

export function PortsTabContent({ projectSessions, workspaceSessions }: PortsTabContentProps) {
  const [manual, setManual] = useState<{ id: string; port: number }[]>([]);
  const [forwardUiOpen, setForwardUiOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const sessionRows = useMemo(() => {
    const map = new Map<number, { port: number; process: string; origin: string }>();
    const add = (session: (typeof projectSessions)[number], origin: string) => {
      if (session.port == null || session.port <= 0) return;
      if (!map.has(session.port)) {
        map.set(session.port, { port: session.port, process: session.name, origin });
      }
    };
    projectSessions.forEach((session) => add(session, "Project"));
    workspaceSessions.forEach((session) => add(session, "Workspace"));
    return Array.from(map.values()).sort((a, b) => a.port - b.port);
  }, [projectSessions, workspaceSessions]);

  const hasAnyRows = sessionRows.length > 0 || manual.length > 0;
  const showTable = hasAnyRows || forwardUiOpen;

  const addManual = () => {
    const parsed = parseUserPort(draft);
    if (parsed == null) return;
    const exists =
      sessionRows.some((row) => row.port === parsed) ||
      manual.some((entry) => entry.port === parsed);
    if (exists) {
      setDraft("");
      return;
    }
    setManual((previous) => [...previous, { id: crypto.randomUUID(), port: parsed }]);
    setDraft("");
  };

  const handleDraftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value);
  };

  const handleDraftKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") addManual();
  };

  const handleOpenForwardUi = () => {
    setForwardUiOpen(true);
  };

  const handleCancelForwardUi = () => {
    setForwardUiOpen(false);
    setDraft("");
  };

  const handleRemoveManualEntry = (id: string) => {
    setManual((previous) => previous.filter((item) => item.id !== id));
  };

  if (!showTable) {
    return (
      <div className="bg-[var(--theme-bg)] px-4 py-5">
        <p className="mb-4 max-w-lg text-sm text-[var(--theme-text-muted)]">
          No forwarded ports. Forward a port to access your locally running services over the
          internet.
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
    <div className="flex h-full min-h-0 flex-col bg-[var(--theme-bg)]">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--theme-border)] text-[11px] uppercase tracking-wide text-[var(--theme-text-muted)]">
              <th className="px-3 py-2 font-medium">Port</th>
              <th className="py-2 font-medium">Forwarded Address</th>
              <th className="py-2 font-medium">Running Process</th>
              <th className="py-2 pr-3 font-medium">Origin</th>
            </tr>
          </thead>
          <tbody className="text-[var(--theme-text)]">
            {forwardUiOpen && (
              <tr className="border-b border-[var(--theme-border)] bg-[var(--theme-bg)]">
                <td className="px-3 py-2 align-middle">
                  <input
                    value={draft}
                    onChange={handleDraftChange}
                    onKeyDown={handleDraftKeyDown}
                    placeholder="Port number or address (e.g. 3000 or localhost:3000)"
                    className="w-full min-w-[200px] rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1.5 text-xs text-[var(--theme-text)] placeholder:text-[var(--theme-text-faint)]"
                  />
                </td>
                <td className="py-2 align-middle text-[var(--theme-text-faint)]">—</td>
                <td className="py-2 align-middle text-[var(--theme-text-faint)]">—</td>
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
                    onClick={handleCancelForwardUi}
                    className="ml-3 text-xs text-[var(--theme-text-muted)] hover:text-[var(--theme-text)]"
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            )}
            {sessionRows.map((row) => (
              <PortDataRow
                key={`s-${row.port}`}
                port={row.port}
                process={row.process}
                origin={row.origin}
              />
            ))}
            {manual.map((entry) => (
              <PortDataRow
                key={entry.id}
                port={entry.port}
                process="—"
                origin="Forwarded"
                onRemove={() => handleRemoveManualEntry(entry.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
      {hasAnyRows && (
        <div className="shrink-0 border-t border-[var(--theme-border)] bg-[var(--theme-bg)] px-3 py-2">
          <button
            type="button"
            onClick={handleOpenForwardUi}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
          >
            Forward a Port
          </button>
        </div>
      )}
    </div>
  );
}
