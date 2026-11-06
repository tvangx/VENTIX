import { get } from "node:http";
import { pollUntil } from "./booking-redis";

export interface SeatFrame {
  event: string;
  data: unknown;
  at: number;
}

export async function openSeatStream(url: string, token: string) {
  const frames: SeatFrame[] = [];
  let buffer = "";
  const connection = get(url, { headers: { Authorization: `Bearer ${token}` } });
  const response = await new Promise<import("node:http").IncomingMessage>((resolve, reject) => {
    connection.once("response", resolve);
    connection.once("error", reject);
  });
  if (response.statusCode !== 200) {
    connection.destroy();
    throw new Error(`SSE returned ${response.statusCode}`);
  }
  response.setEncoding("utf8");
  response.on("data", (chunk: string) => {
    buffer += chunk;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (event && data) frames.push({ event, data: JSON.parse(data) as unknown, at: Date.now() });
    }
  });
  return {
    frames,
    response,
    close: () => {
      response.destroy();
      connection.destroy();
    },
    wait: async (predicate: (frame: SeatFrame) => boolean, timeout = 5000) => {
      await pollUntil(async () => frames.some(predicate), timeout);
      return frames.find(predicate)!;
    },
  };
}
