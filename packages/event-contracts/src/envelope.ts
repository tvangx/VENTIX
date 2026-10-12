import { randomUUID } from "node:crypto";
import { z } from "zod";

/**
 * Envelope chung cho MỌI message Kafka.
 * Lưu ý: Tài liệu KT ghi `event_id`; ở đây đổi thành `message_id` để không nhầm với
 * `event_id` nghiệp vụ (sự kiện ca nhạc) nằm trong `data`. Bảng Inbox dùng cột `message_id`.
 */
export const envelopeBase = z.object({
  message_id: z.string().uuid(),
  type: z.string().min(1),
  version: z.number().int().positive(),
  occurred_at: z.string().datetime(),
  trace_id: z.string().optional(),
  tenant_id: z.string().uuid().optional(), // organizer_id nếu có
});

export function envelope<T extends string, D extends z.ZodTypeAny>(type: T, data: D, version = 1) {
  return envelopeBase.extend({
    type: z.literal(type),
    version: z.literal(version),
    data,
  });
}

/** Tạo message mới. TODO(T-103): đổi sang UUIDv7 (gói `uuidv7`) để index theo thời gian. */
export function newMessage<T extends string, D>(
  type: T,
  data: D,
  opts: { version?: number; trace_id?: string; tenant_id?: string } = {},
) {
  return {
    message_id: randomUUID(),
    type,
    version: opts.version ?? 1,
    occurred_at: new Date().toISOString(),
    trace_id: opts.trace_id,
    tenant_id: opts.tenant_id,
    data,
  };
}
