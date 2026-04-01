import pino from "pino";

export const logger = pino({
  name: "pandora-daemon",
  level: process.env.LOG_LEVEL ?? "info",
  transport: process.env.NODE_ENV !== "production"
    ? { target: "pino/file", options: { destination: "/tmp/pandora-terminal.log", mkdir: true, append: false } }
    : undefined,
});
