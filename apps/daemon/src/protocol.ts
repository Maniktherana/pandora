import type { Socket } from "node:net";
import { appendFileSync } from "node:fs";

const LOG_PATH = "/tmp/pandora-terminal.log";
const T0 = Date.now();

export function dlog(tag: string, msg: string): void {
  const elapsed = ((Date.now() - T0) / 1000).toFixed(3);
  try {
    appendFileSync(LOG_PATH, `${elapsed.padStart(10)} [${tag}] (daemon:${process.pid}) ${msg}\n`);
  } catch {}
}

export function writeMessage(socket: Socket, message: object): void {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  socket.write(header);
  socket.write(payload);
}

export function createMessageReader(
  onMessage: (message: unknown) => void,
  onError?: (error: Error) => void
): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);

  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32BE(0);
      if (buffer.length < 4 + length) {
        break;
      }

      const payload = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);

      try {
        onMessage(JSON.parse(payload.toString("utf8")));
      } catch (error) {
        onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }
  };
}
