import { execFile } from "node:child_process";

export interface ScannedPort {
  port: number;
  pid: number;
  processName: string;
  address: string;
}

const EXEC_TIMEOUT_MS = 5_000;
const MAX_BUFFER = 10 * 1024 * 1024;
const IGNORED_PORTS = new Set([22, 80, 443, 5432, 3306, 6379, 27017]);

const ADDRESS_RE = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/;

function parseLsofLine(
  line: string,
  pidSet: Set<number>,
): ScannedPort | null {
  const columns = line.trim().split(/\s+/);
  if (columns.length < 9) return null;

  const processName = columns[0] ?? "";
  const pidStr = columns[1];
  const name = columns[8];
  if (!pidStr || !name) return null;

  const pid = Number(pidStr);
  if (!Number.isFinite(pid) || !pidSet.has(pid)) return null;

  const match = ADDRESS_RE.exec(name);
  if (!match) return null;

  const rawAddress = match[1] ?? match[2] ?? "";
  const portNum = Number(match[3]);
  if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) return null;
  if (IGNORED_PORTS.has(portNum)) return null;

  const address = rawAddress === "*" ? "0.0.0.0" : rawAddress;

  return { port: portNum, pid, processName, address };
}

export function scanListeningPorts(pids: number[]): Promise<ScannedPort[]> {
  if (pids.length === 0) return Promise.resolve([]);

  const pidArg = pids.join(",");
  const pidSet = new Set(pids);

  return new Promise((resolve) => {
    execFile(
      "lsof",
      ["-p", pidArg, "-iTCP", "-sTCP:LISTEN", "-P", "-n"],
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (error, stdout) => {
        if (!stdout) {
          resolve([]);
          return;
        }

        const lines = stdout.split("\n").slice(1); // skip header
        const seen = new Map<number, ScannedPort>();

        for (const line of lines) {
          const parsed = parseLsofLine(line, pidSet);
          if (parsed && !seen.has(parsed.port)) {
            seen.set(parsed.port, parsed);
          }
        }

        resolve(Array.from(seen.values()));
      },
    );
  });
}

/** Walk the process tree from `rootPid` using `ps`. No external deps. */
export function getProcessTree(rootPid: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-o", "pid=,ppid=", "-ax"],
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (error, stdout) => {
        if (!stdout) {
          resolve([rootPid]);
          return;
        }

        const children = new Map<number, number[]>();
        for (const line of stdout.trim().split("\n")) {
          const parts = line.trim().split(/\s+/);
          const pid = Number(parts[0]);
          const ppid = Number(parts[1]);
          if (pid > 0 && ppid >= 0) {
            let list = children.get(ppid);
            if (!list) {
              list = [];
              children.set(ppid, list);
            }
            list.push(pid);
          }
        }

        // BFS from root
        const result = [rootPid];
        const queue = [rootPid];
        while (queue.length > 0) {
          const current = queue.shift()!;
          const kids = children.get(current);
          if (kids) {
            for (const kid of kids) {
              result.push(kid);
              queue.push(kid);
            }
          }
        }

        resolve(result);
      },
    );
  });
}
