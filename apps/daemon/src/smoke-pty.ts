async function runCycle(label: string): Promise<void> {
  const shell = process.env.SHELL || "/bin/zsh";
  let sawReady = false;
  let sawReply = false;

  const proc = Bun.spawn([shell, "-lc", "echo ready; read line; echo reply:$line"], {
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
        const text = Buffer.from(data).toString("utf8");
        if (text.includes("ready") && !sawReady) {
          sawReady = true;
          term.write(`${label}\n`);
          term.resize(100, 30);
        }
        if (text.includes(`reply:${label}`)) {
          sawReply = true;
        }
      },
    },
  });

  const exitCode = await proc.exited;
  proc.terminal?.close();

  if (!(sawReady && sawReply && exitCode === 0)) {
    throw new Error("PTY smoke cycle did not complete");
  }
}

await runCycle("cycle1");
await runCycle("cycle2");
console.log("pandorad smoke pty OK");
