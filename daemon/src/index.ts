import { DaemonServer } from "./daemon";

async function main(): Promise<void> {
  const workspacePath = process.argv[2];
  if (!workspacePath) {
    console.error("Usage: pandorad <workspace-path> [default-cwd]");
    process.exit(1);
  }
  const defaultCwd = process.argv[3];

  const server = new DaemonServer(workspacePath, defaultCwd);
  await server.start();

  let shuttingDown = false;
  const shutdown = async (reason?: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (reason) {
      console.log(reason);
    }
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("pandorad received SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("pandorad received SIGTERM");
  });

  const parentPIDRaw = process.env.PANDORA_PARENT_PID;
  const parentPID = parentPIDRaw ? Number(parentPIDRaw) : null;
  if (parentPID && Number.isFinite(parentPID) && parentPID > 1) {
    setInterval(() => {
      try {
        process.kill(parentPID, 0);
      } catch {
        void shutdown(`pandorad shutting down: parent process ${parentPID} exited`);
      }
    }, 1_000);
  }
}

void main().catch((error) => {
  console.error("pandorad failed:", error);
  process.exit(1);
});
