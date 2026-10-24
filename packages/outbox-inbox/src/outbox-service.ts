import { parseMessage, topicOf } from "@ticketing/event-contracts";
import type { SqlExecutor } from "./sql-executor";

export type ParsedMessage = ReturnType<typeof parseMessage>;

/**
 * Ghi sự kiện vào `outbox_events` bằng chính `SqlExecutor` (transaction) của nghiệp vụ.
 * Nếu transaction rollback thì sự kiện cũng biến mất — đó là mục đích của Outbox.
 */
export class OutboxService {
  /**
   * @param exec    executor gắn với transaction nghiệp vụ của caller
   * @param message message thô (thường từ `newMessage`); được validate bằng `parseMessage` trước khi ghi
   * @param key     `message_key` Kafka (xem key theo từng topic trong `topics.ts`, ví dụ `order_id`)
   * @returns message đã parse (payload thực sự được ghi)
   */
  async add(exec: SqlExecutor, message: unknown, key: string): Promise<ParsedMessage> {
    if (key.length === 0) {
      throw new Error("Outbox message key must not be empty");
    }
    const parsed = parseMessage(message);
    await exec.query(
      `INSERT INTO outbox_events (id, topic, message_key, event_type, payload)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb)
       RETURNING id`,
      [parsed.message_id, topicOf[parsed.type], key, parsed.type, JSON.stringify(parsed)],
    );
    return parsed;
  }
}
