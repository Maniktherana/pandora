import * as pty from "node-pty";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

type WorkerMessage =
  | {
      type: "spawn";
      shell: string;
      cmd: string;
      cwd: string;
      env: Record<string, string>;
      cols: number;
      rows: number;
    }
  | { type: "write"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "kill"; signal?: NodeJS.Signals };

let ptyProcess: pty.IPty | null = null;
let paused = false;
let outputBuffer: Buffer[] = [];
let outputBufferBytes = 0;
let batchTimer: NodeJS.Timeout | null = null;
let lastFgProcess: string | null = null;

const OUTPUT_BUFFER_MAX = 256 * 1024;
const BATCH_INTERVAL_MS = 4;
const BATCH_MAX_BYTES = 64 * 1024;
const require = createRequire(import.meta.url);

function ensureNodePtySpawnHelperExecutable(): void {
  const packageRoot = path.dirname(require.resolve("node-pty/package.json"));
  const prebuildsDir = path.join(packageRoot, "prebuilds");
  if (!existsSync(prebuildsDir)) {
    return;
  }

  for (const entry of readdirSync(prebuildsDir)) {
    const helperPath = path.join(prebuildsDir, entry, "spawn-helper");
    if (existsSync(helperPath)) {
      chmodSync(helperPath, 0o755);
    }
  }
}

function send(message: object): void {
  if (typeof process.send === "function") {
    process.send(message);
  }
}

function clearBatchTimer(): void {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
}

function queueOutput(buf: Buffer): void {
  outputBuffer.push(buf);
  outputBufferBytes += buf.length;

  while (outputBufferBytes > OUTPUT_BUFFER_MAX && outputBuffer.length > 1) {
    const dropped = outputBuffer.shift();
    if (!dropped) {
      break;
    }
    outputBufferBytes -= dropped.length;
  }

  if (paused) {
    return;
  }

  if (outputBufferBytes >= BATCH_MAX_BYTES) {
    flushOutput();
    return;
  }

  if (!batchTimer) {
    batchTimer = setTimeout(() => {
      batchTimer = null;
      flushOutput();
    }, BATCH_INTERVAL_MS);
  }
}

function checkForegroundProcess(): void {
  if (!ptyProcess) return;
  const current = ptyProcess.process;
  if (current !== lastFgProcess) {
    lastFgProcess = current;
    send({ type: "foregroundProcess", name: current });
  }
}

function flushOutput(): void {
  if (paused || outputBuffer.length === 0) {
    return;
  }

  clearBatchTimer();
  const merged =
    outputBuffer.length === 1
      ? outputBuffer[0]!
      : Buffer.concat(outputBuffer, outputBufferBytes);
  outputBuffer = [];
  outputBufferBytes = 0;
  send({ type: "output", data: merged });
  checkForegroundProcess();
}

function spawnPTY(
  shell: string,
  cmd: string,
  cwd: string,
  env: Record<string, string>,
  cols: number,
  rows: number,
): void {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }

  paused = false;
  clearBatchTimer();
  outputBuffer = [];
  outputBufferBytes = 0;
  ensureNodePtySpawnHelperExecutable();

  ptyProcess = pty.spawn(shell, ["-lc", cmd], {
    name: "xterm-256color",
    cols: Math.max(cols, 1),
    rows: Math.max(rows, 1),
    cwd,
    env,
  });

  ptyProcess.onData((data) => {
    queueOutput(Buffer.from(data, "utf8"));
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    flushOutput();
    send({ type: "exited", exitCode, signal: signal ?? null });
    process.exit(exitCode ?? 0);
  });

  send({ type: "spawned", pid: ptyProcess.pid });
}

process.on("message", (msg: WorkerMessage) => {
  switch (msg.type) {
    case "spawn":
      spawnPTY(msg.shell, msg.cmd, msg.cwd, msg.env, msg.cols, msg.rows);
      break;
    case "write":
      ptyProcess?.write(msg.data);
      break;
    case "resize":
      ptyProcess?.resize(Math.max(msg.cols, 1), Math.max(msg.rows, 1));
      break;
    case "pause":
      paused = true;
      clearBatchTimer();
      ptyProcess?.pause();
      break;
    case "resume":
      paused = false;
      ptyProcess?.resume();
      flushOutput();
      break;
    case "kill":
      ptyProcess?.kill(msg.signal);
      break;
  }
});

process.on("disconnect", () => {
  ptyProcess?.kill();
  process.exit(0);
});
