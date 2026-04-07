import { open } from "@tauri-apps/plugin-shell";

type PortDataRowProps = {
  port: number;
  process: string;
  origin: string;
  onRemove?: () => void;
};

export function PortDataRow({ port, process, origin, onRemove }: PortDataRowProps) {
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
