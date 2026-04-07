export type BottomTab = "terminal" | "ports";

export function clampPort(n: number): number | null {
  if (!Number.isFinite(n) || n < 1 || n > 65535) return null;
  return Math.floor(n);
}

export function parseUserPort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hostPort = trimmed.match(/^[\w.-]+:(\d{1,5})$/);
  if (hostPort) return clampPort(Number(hostPort[1]));
  if (/^\d{1,5}$/.test(trimmed)) return clampPort(Number(trimmed));
  return null;
}

