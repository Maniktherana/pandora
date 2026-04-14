import { open } from "@tauri-apps/plugin-shell";

type PortDataRowProps = {
  port: number;
  processName: string;
  address: string;
  source: string;
};

export function PortDataRow({ port, processName, address, source }: PortDataRowProps) {
  const displayAddr =
    address === "0.0.0.0" || address === "::" || address === "::1"
      ? `localhost:${port}`
      : `${address}:${port}`;

  return (
    <tr className="border-b border-[var(--theme-border)]">
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
          {displayAddr}
        </button>
      </td>
      <td className="max-w-[220px] truncate py-2 text-[var(--theme-text)]" title={processName}>
        {processName}
      </td>
      <td className="py-2 pr-3">
        <span className="text-[var(--theme-text-muted)]">{source}</span>
      </td>
    </tr>
  );
}
