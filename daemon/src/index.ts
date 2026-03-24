import { DaemonServer } from "./daemon";

async function main(): Promise<void> {
  const projectPath = process.argv[2];
  if (!projectPath) {
    console.error("Usage: pandorad <project-path>");
    process.exit(1);
  }

  const server = new DaemonServer(projectPath);
  await server.start();

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((error) => {
  console.error("pandorad failed:", error);
  process.exit(1);
});
