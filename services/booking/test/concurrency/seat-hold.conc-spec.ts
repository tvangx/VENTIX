import { randomUUID } from "node:crypto";
import { registerSeatHoldCommands } from "../../src/seat-hold/seat-hold-redis";
import { BookingRedis, startBookingRedis } from "../support/booking-redis";

describe("atomic Redis seat contention", () => {
  let db: BookingRedis;
  beforeAll(async () => {
    db = await startBookingRedis();
  });
  afterAll(async () => db?.close());

  it("100 parallel users competing for one seat produce exactly one winner", async () => {
    const event = randomUUID();
    const clients = Array.from({ length: 100 }, () =>
      registerSeatHoldCommands(db.redis.duplicate(), false),
    );
    const seat = `seat:{evt:${event}}:A`;
    try {
      // Barrier: mọi kết nối đã sẵn sàng trước khi gửi tác vụ tranh ghế.
      await Promise.all(clients.map((client) => client.ping()));
      const results = await Promise.all(
        clients.map((client, i) =>
          client.holdSeats(
            2,
            `hold:{evt:${event}}:user-${i}`,
            seat,
            `H:user-${i}`,
            10,
            6,
            Date.now(),
            "A",
          ),
        ),
      );
      expect(results.filter((result) => result[0] === 1)).toHaveLength(1);
      expect(results.filter((result) => result[0] === 0)).toHaveLength(99);
      expect(await db.redis.get(seat)).toBe(
        `H:user-${results.findIndex((result) => result[0] === 1)}`,
      );
      expect(await db.redis.zcard(`hexp:{evt:${event}}`)).toBe(1);
    } finally {
      await Promise.all(clients.map((client) => client.quit()));
    }
  });
});
