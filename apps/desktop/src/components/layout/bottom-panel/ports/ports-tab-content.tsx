import { useMemo } from "react";
import { PortDataRow } from "./port-data-row";
import { useRuntimeStore } from "@/state/runtime-store";
import { useDesktopView } from "@/hooks/use-desktop-view";
import { isProjectRuntimeKey } from "@/lib/runtime/runtime-keys";
import type { DetectedPort, WorkspaceRecord } from "@/lib/shared/types";

interface PortRow {
  port: number;
  processName: string;
  address: string;
  source: string;
}

function buildPortRows(
  runtimeState: Readonly<Record<string, import("@/lib/shared/types").WorkspaceRuntimeState>>,
  workspaces: readonly WorkspaceRecord[],
): PortRow[] {
  const wsNameById = new Map(workspaces.map((ws) => [ws.id, ws.name]));
  const seen = new Map<number, PortRow>();

  for (const [runtimeId, runtime] of Object.entries(runtimeState)) {
    if (!runtime.detectedPorts?.length) continue;

    let source: string;
    if (isProjectRuntimeKey(runtimeId)) {
      source = "Project";
    } else {
      source = wsNameById.get(runtimeId) ?? runtimeId.slice(0, 8);
    }

    for (const p of runtime.detectedPorts) {
      if (!seen.has(p.port)) {
        seen.set(p.port, {
          port: p.port,
          processName: p.processName,
          address: p.address,
          source,
        });
      }
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.port - b.port);
}

export function PortsTabContent() {
  const runtimeState = useRuntimeStore((s) => s.runtimeState);
  const workspaces = useDesktopView((v) => v.workspaces);

  const rows = useMemo(() => buildPortRows(runtimeState, workspaces), [runtimeState, workspaces]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-sm font-medium text-[var(--theme-text)]">No ports detected</p>
        <p className="max-w-sm text-xs text-[var(--theme-text-muted)]">
          Ports from running sessions will appear here automatically.
        </p>
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
              <th className="py-2 font-medium">Local Address</th>
              <th className="py-2 font-medium">Process</th>
              <th className="py-2 pr-3 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="text-[var(--theme-text)]">
            {rows.map((row) => (
              <PortDataRow
                key={row.port}
                port={row.port}
                processName={row.processName}
                address={row.address}
                source={row.source}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
