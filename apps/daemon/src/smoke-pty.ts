import * as pty from "node-pty";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

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

async function runCycle(label: string): Promise<void> {
  ensureNodePtySpawnHelperExecutable();
  const shell = process.env.SHELL || "/bin/zsh";
  await new Promise<void>((resolve, reject) => {
    let output = "";
    let wroteInput = false;
    const proc = pty.spawn(shell, ["-lc", "echo ready; read line; echo reply:$line"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
      cols: 80,
      rows: 24,
      name: "xterm-256color",
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("PTY smoke cycle timed out"));
    }, 5_000);

    proc.onData((data) => {
      output += data;
      if (output.includes("ready") && !wroteInput) {
        wroteInput = true;
        proc.resize(100, 30);
        proc.write(`${label}\n`);
      }
    });

    proc.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      if (exitCode === 0 && output.includes(`reply:${label}`)) {
        resolve();
      } else {
        reject(new Error(`PTY smoke cycle failed with exit=${exitCode} output=${JSON.stringify(output)}`));
      }
    });
  });
}

await runCycle("cycle1");
await runCycle("cycle2");
console.log("pandorad smoke pty OK");
