import { randomUUID } from "node:crypto";
import { newMessage, Topics } from "@ticketing/event-contracts";
import { OutboxService } from "./outbox-service";
import { fromPgClient, fromPrismaTx } from "./sql-executor";
import type { SqlExecutor } from "./sql-executor";

const validMessage = () =>
  newMessage("OrderAwaitingPayment", {
    order_id: randomUUID(),
    user_id: randomUUID(),
    event_id: randomUUID(),
    amount_vnd: 500_000,
    expires_at: new Date(Date.now() + 900_000).toISOString(),
  });

function recordingExecutor(): {
  exec: SqlExecutor;
  calls: Array<{ sql: string; params?: unknown[] }>;
} {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    exec: {
      async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
        calls.push({ sql, params });
        return [];
      },
    },
  };
}

describe("OutboxService.add", () => {
  it("ghi đúng topic theo topicOf, key do caller truyền và payload là envelope đầy đủ", async () => {
    const { exec, calls } = recordingExecutor();
    const msg = validMessage();

    await new OutboxService().add(exec, msg, msg.data.order_id);

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain("INSERT INTO outbox_events");
    const [id, topic, key, type, payload] = calls[0].params as string[];
    expect(id).toBe(msg.message_id);
    expect(topic).toBe(Topics.BOOKING_ORDERS);
    expect(key).toBe(msg.data.order_id);
    expect(type).toBe("OrderAwaitingPayment");
    expect(JSON.parse(payload)).toMatchObject({ message_id: msg.message_id, data: msg.data });
  });

  it("từ chối message sai schema và KHÔNG ghi gì", async () => {
    const { exec, calls } = recordingExecutor();
    const bad = { ...validMessage(), data: { order_id: "không-phải-uuid" } };

    await expect(new OutboxService().add(exec, bad, "k")).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("từ chối type lạ và key rỗng", async () => {
    const { exec, calls } = recordingExecutor();
    await expect(new OutboxService().add(exec, { type: "Nope" }, "k")).rejects.toThrow(
      /Unknown event type/,
    );
    await expect(new OutboxService().add(exec, validMessage(), "")).rejects.toThrow(/key/);
    expect(calls).toHaveLength(0);
  });

  it("để lỗi của DB nổi lên cho caller (rollback nghiệp vụ)", async () => {
    const exec: SqlExecutor = {
      query: () => Promise.reject(new Error("duplicate key")),
    };
    await expect(new OutboxService().add(exec, validMessage(), "k")).rejects.toThrow(
      "duplicate key",
    );
  });
});

describe("adapters", () => {
  it("fromPgClient trả về rows và mặc định params rỗng", async () => {
    const seen: Array<[string, unknown[] | undefined]> = [];
    const exec = fromPgClient({
      query: async (text, values) => {
        seen.push([text, values]);
        return { rows: [{ a: 1 }] };
      },
    });
    await expect(exec.query("SELECT 1")).resolves.toEqual([{ a: 1 }]);
    expect(seen).toEqual([["SELECT 1", []]]);
  });

  it("fromPrismaTx trải params thành đối số và coi kết quả rỗng là []", async () => {
    const calls: unknown[][] = [];
    const exec = fromPrismaTx({
      $queryRawUnsafe: async <T>(...args: unknown[]) => {
        calls.push(args);
        return undefined as T;
      },
    });
    await expect(exec.query("SELECT $1, $2", ["a", 2])).resolves.toEqual([]);
    expect(calls).toEqual([["SELECT $1, $2", "a", 2]]);
  });
});
