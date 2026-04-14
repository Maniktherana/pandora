import type { Socket } from "node:net";

type NodeBuffer = Buffer<ArrayBufferLike>;

export function writeControlMessage(socket: Socket, message: object): boolean {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const frame = Buffer.allocUnsafe(4 + payload.length);
  frame.writeUInt32BE(payload.length, 0);
  payload.copy(frame, 4);
  return socket.write(frame);
}

export function createControlMessageReader(
  onMessage: (message: unknown) => void,
  onError?: (error: Error) => void,
): (chunk: NodeBuffer) => void {
  let buffer: NodeBuffer = Buffer.alloc(0);

  return (chunk: NodeBuffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
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

export function writeOutputFrame(socket: Socket, sessionID: string, data: NodeBuffer): boolean {
  const session = Buffer.from(sessionID, "utf8");
  if (session.length > 255) {
    throw new Error(`sessionID too long for output frame: ${sessionID.length}`);
  }

  const payloadLength = 1 + session.length + data.length;
  const frame = Buffer.allocUnsafe(4 + payloadLength);
  frame.writeUInt32BE(payloadLength, 0);
  frame.writeUInt8(session.length, 4);
  session.copy(frame, 5);
  data.copy(frame, 5 + session.length);
  return socket.write(frame);
}

export function createOutputFrameReader(
  onFrame: (sessionID: string, data: NodeBuffer) => void,
  onError?: (error: Error) => void,
): (chunk: NodeBuffer) => void {
  let buffer: NodeBuffer = Buffer.alloc(0);

  return (chunk: NodeBuffer) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
    while (buffer.length >= 5) {
      const length = buffer.readUInt32BE(0);
      if (length < 1) {
        onError?.(new Error("output frame missing session id length"));
        buffer = Buffer.alloc(0);
        return;
      }
      if (buffer.length < 4 + length) {
        break;
      }

      const sessionLength = buffer.readUInt8(4);
      if (length < 1 + sessionLength) {
        onError?.(new Error("output frame truncated session id"));
        buffer = buffer.subarray(4 + length);
        continue;
      }

      const sessionStart = 5;
      const sessionEnd = sessionStart + sessionLength;
      const payloadEnd = 4 + length;
      const sessionID = buffer.subarray(sessionStart, sessionEnd).toString("utf8");
      const data = buffer.subarray(sessionEnd, payloadEnd);
      buffer = buffer.subarray(payloadEnd);
      onFrame(sessionID, data);
    }
  };
}
