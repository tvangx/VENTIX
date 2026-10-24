import { randomUUID } from "node:crypto";
import { newMessage } from "@ticketing/event-contracts";
import { InboxProcessor, PermanentError } from "./inbox-consumer";
import type { DeadLetter, InboxRecord } from "./inbox-consumer";
import type { Database, SqlExecutor } from "./sql-executor";

const validValue = () =>
  Buffer.from(
    JSON.stringify(
      newMessage("OrderAwaitingPayment", {
        order_id: randomUUID(),
        user_id: randomUUID(),
        event_id: randomUUID(),
        amount_vnd: 1,
        expires_at: new Date(Date.now() + 900_000).toISOString(),
      }),
    ),
  );

const record = (value: Buffer | null): InboxRecord => ({
  topic: "booking.orders",
  partition: 0,
  offset: "7",
  key: Buffer.from("k"),
  value,
});

/** DB giả: nhớ message_id đã "commit" vào processed_events; transaction lỗi thì không nhớ (rollback). */
function fakeDb() {
  const processed = new Set<string>();
  let transactions = 0;
  const db: Database = {
    async transaction<R>(fn: (exec: SqlExecutor) => Promise<R>): Promise<R> {
      transactions++;
      const staged: string[] = [];
      const exec: SqlExecutor = {
        async query<T>(_sql: string, params: unknown[] = []): Promise<T[]> {
          const key = `${String(params[0])}|${String(params[1])}`;
          if (processed.has(key) || staged.includes(key)) return [];
          staged.push(key);
          return [{ message_id: params[0] }] as T[];
        },
      };
      const result = await fn(exec);
      staged.forEach((k) => processed.add(k));
      return result;
    },
  };
  return { db, processed, transactions: () => transactions };
}

function build(handler: jest.Mock, db: Database, maxAttempts = 3) {
  const letters: DeadLetter[] = [];
  const sleeps: number[] = [];
  const processor = new InboxProcessor({
    consumerName: "c1",
    db,
    handler,
    maxAttempts,
    baseBackoffMs: 100,
    maxBackoffMs: 1000,
    random: () => 0.5,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    deadLetter: async (l) => {
      letters.push(l);
    },
  });
  return { processor, letters, sleeps };
}

describe("InboxProcessor", () => {
  it("xử lý message hợp lệ đúng 1 lần, gọi lại cùng message là bỏ qua", async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const { db } = fakeDb();
    const { processor, letters } = build(handler, db);
    const rec = record(validValue());

    await expect(processor.process(rec)).resolves.toBe("processed");
    await expect(processor.process(rec)).resolves.toBe("duplicate");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(letters).toHaveLength(0);
  });

  it("sai schema, sai JSON hoặc rỗng ⇒ DLQ ngay, handler không được gọi", async () => {
    const handler = jest.fn();
    const { db, transactions } = fakeDb();
    const { processor, letters } = build(handler, db);

    for (const value of [
      Buffer.from(JSON.stringify({ type: "OrderAwaitingPayment" })),
      Buffer.from("{không phải json"),
      null,
    ]) {
      await expect(processor.process(record(value))).resolves.toBe("dead-lettered");
    }

    expect(handler).not.toHaveBeenCalled();
    expect(transactions()).toBe(0);
    expect(letters).toHaveLength(3);
    expect(letters.every((l) => l.attempts === 1 && l.error.length > 0)).toBe(true);
  });

  it("lỗi tạm thời 2 lần rồi thành công ⇒ xử lý đúng 1 lần, có backoff giữa các lần", async () => {
    let calls = 0;
    const effects: string[] = [];
    const handler = jest.fn(async () => {
      calls++;
      if (calls <= 2) throw new Error("db tạm thời lỗi");
      effects.push("done");
    });
    const { db, processed } = fakeDb();
    const { processor, letters, sleeps } = build(handler, db);

    await expect(processor.process(record(validValue()))).resolves.toBe("processed");

    expect(effects).toEqual(["done"]);
    expect(handler).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([50, 100]); // random=0.5 → nửa của 100, 200
    expect(processed.size).toBe(1);
    expect(letters).toHaveLength(0);
  });

  it("quá maxAttempts ⇒ DLQ kèm số lần thử và lỗi; không đánh dấu đã xử lý", async () => {
    const handler = jest.fn().mockRejectedValue(new Error("luôn lỗi"));
    const { db, processed } = fakeDb();
    const { processor, letters } = build(handler, db, 3);

    await expect(processor.process(record(validValue()))).resolves.toBe("dead-lettered");

    expect(handler).toHaveBeenCalledTimes(3);
    expect(letters).toHaveLength(1);
    expect(letters[0].attempts).toBe(3);
    expect(letters[0].error).toContain("luôn lỗi");
    expect(processed.size).toBe(0);
  });

  it("PermanentError ⇒ DLQ ngay ở lần thử đầu, không retry", async () => {
    const handler = jest.fn().mockRejectedValue(new PermanentError("dữ liệu sai"));
    const { db } = fakeDb();
    const { processor, letters, sleeps } = build(handler, db);

    await expect(processor.process(record(validValue()))).resolves.toBe("dead-lettered");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(sleeps).toHaveLength(0);
    expect(letters[0].attempts).toBe(1);
  });

  it("gửi DLQ thất bại ⇒ ném lỗi để KHÔNG commit offset", async () => {
    const handler = jest.fn();
    const { db } = fakeDb();
    const processor = new InboxProcessor({
      consumerName: "c1",
      db,
      handler,
      deadLetter: () => Promise.reject(new Error("kafka down")),
    });

    await expect(processor.process(record(Buffer.from("x")))).rejects.toThrow("kafka down");
  });

  it("đang shutdown giữa lúc retry ⇒ ném lỗi để message được giao lại", async () => {
    const ac = new AbortController();
    const handler = jest.fn().mockRejectedValue(new Error("lỗi tạm"));
    const { db } = fakeDb();
    const processor = new InboxProcessor({
      consumerName: "c1",
      db,
      handler,
      signal: ac.signal,
      sleep: async () => ac.abort(),
      deadLetter: async () => undefined,
    });

    await expect(processor.process(record(validValue()))).rejects.toThrow(/shutting down/);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
