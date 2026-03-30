import { describe, expect, test } from "bun:test";

async function spawnAndWaitOnce(): Promise<string> {
  const shell = process.env.SHELL ?? "/bin/sh";
  let output = "";

  const proc = Bun.spawn([shell, "-lc", 'echo ready; read line; printf "pong:%s\\n" "$line"'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TERM: "xterm-256color",
    },
    terminal: {
      cols: 80,
      rows: 24,
      name: "xterm-256color",
      data(term, data) {
        const chunk = Buffer.from(data).toString("utf8");
        output += chunk;
        if (chunk.includes("ready")) {
          term.resize(100, 30);
          term.write("hello\n");
        }
      },
    },
  });

  const exitCode = await proc.exited;
  proc.terminal?.close();

  if (exitCode !== 0) {
    throw new Error(`PTY exited before producing output: ${exitCode}`);
  }

  return output;
}

describe("bun terminal smoke gate", () => {
  test("spawns, writes, resizes, and exits twice under bun", async () => {
    const first = await spawnAndWaitOnce();
    const second = await spawnAndWaitOnce();

    expect(first).toContain("pong:hello");
    expect(second).toContain("pong:hello");
  });
});
