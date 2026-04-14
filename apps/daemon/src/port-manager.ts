import { logger } from "./logger";
import { getProcessTree, scanListeningPorts } from "./port-scanner";
import type { DetectedPort } from "./types";

const SCAN_INTERVAL_MS = 3_000;
const HINT_SCAN_DELAY_MS = 500;

const PORT_HINT_PATTERNS = [
  /listening\s+on\s+(?:port\s+)?(\d+)/i,
  /server\s+(?:started|running)\s+(?:on|at)\s+(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:?(\d+)/i,
  /ready\s+on\s+(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:?(\d+)/i,
  /:(\d{4,5})\s*$/,
];

interface TrackedSession {
  pid: number;
  sessionID: string;
}

export class PortManager {
  private readonly ports = new Map<string, DetectedPort>();
  private readonly trackedSessions = new Map<string, TrackedSession>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private isScanning = false;
  private onChanged: ((ports: DetectedPort[]) => void) | null = null;

  start(): void {
    if (this.scanTimer) return;
    this.scanTimer = setInterval(() => {
      void this.scan();
    }, SCAN_INTERVAL_MS);
    this.scanTimer.unref();
  }

  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
  }

  onPortsChanged(callback: (ports: DetectedPort[]) => void): void {
    this.onChanged = callback;
  }

  registerSession(sessionID: string, pid: number): void {
    this.trackedSessions.set(sessionID, { pid, sessionID });
    logger.debug({ tag: "PORTS", sessionID, pid }, "session registered for port scanning");
  }

  unregisterSession(sessionID: string): void {
    this.trackedSessions.delete(sessionID);
    let removed = false;
    for (const [key, port] of this.ports) {
      if (port.sessionID === sessionID) {
        this.ports.delete(key);
        removed = true;
      }
    }
    if (removed) {
      this.emitChange();
    }
    logger.debug({ tag: "PORTS", sessionID }, "session unregistered from port scanning");
  }

  checkOutputForHint(data: Buffer, sessionID: string): void {
    if (!this.trackedSessions.has(sessionID)) return;

    const text = data.toString("utf8");
    for (const pattern of PORT_HINT_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        const port = Number(match[1]);
        if (port >= 1 && port <= 65535) {
          this.scheduleHintScan();
          return;
        }
      }
    }
  }

  listPorts(): DetectedPort[] {
    return Array.from(this.ports.values());
  }

  private scheduleHintScan(): void {
    if (this.hintTimer) {
      clearTimeout(this.hintTimer);
    }
    this.hintTimer = setTimeout(() => {
      this.hintTimer = null;
      void this.scan();
    }, HINT_SCAN_DELAY_MS);
    this.hintTimer.unref();
  }

  private async scan(): Promise<void> {
    if (this.isScanning) return;
    if (this.trackedSessions.size === 0) return;

    this.isScanning = true;
    try {
      // Collect all PIDs from process trees
      const pidToSession = new Map<number, string>();
      const treePromises: Promise<void>[] = [];

      for (const [sessionID, session] of this.trackedSessions) {
        treePromises.push(
          getProcessTree(session.pid).then((pids) => {
            for (const pid of pids) {
              pidToSession.set(pid, sessionID);
            }
          }),
        );
      }

      await Promise.all(treePromises);

      if (pidToSession.size === 0) {
        // All sessions may have exited
        if (this.ports.size > 0) {
          this.ports.clear();
          this.emitChange();
        }
        return;
      }

      // Single lsof call for all PIDs
      const allPids = Array.from(pidToSession.keys());
      const scannedPorts = await scanListeningPorts(allPids);

      // Build new port map
      const nextPorts = new Map<string, DetectedPort>();
      for (const scanned of scannedPorts) {
        const sessionID = pidToSession.get(scanned.pid);
        if (!sessionID) continue;

        const key = `${sessionID}:${scanned.port}`;
        const existing = this.ports.get(key);
        nextPorts.set(key, {
          port: scanned.port,
          pid: scanned.pid,
          processName: scanned.processName,
          sessionID,
          address: scanned.address,
          detectedAt: existing?.detectedAt ?? Date.now(),
        });
      }

      // Diff and update
      let changed = false;

      // Check for removals
      for (const key of this.ports.keys()) {
        if (!nextPorts.has(key)) {
          changed = true;
          break;
        }
      }

      // Check for additions or updates
      if (!changed) {
        for (const [key, next] of nextPorts) {
          const prev = this.ports.get(key);
          if (!prev || prev.pid !== next.pid || prev.processName !== next.processName) {
            changed = true;
            break;
          }
        }
      }

      if (changed) {
        this.ports.clear();
        for (const [key, port] of nextPorts) {
          this.ports.set(key, port);
        }
        this.emitChange();
      }
    } catch (error) {
      logger.warn(
        { tag: "PORTS", err: error instanceof Error ? error.message : String(error) },
        "port scan failed",
      );
    } finally {
      this.isScanning = false;
    }
  }

  private emitChange(): void {
    if (this.onChanged) {
      this.onChanged(this.listPorts());
    }
  }
}
