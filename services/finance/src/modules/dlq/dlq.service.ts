import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { KafkaMessage, Producer } from "kafkajs";
import { parseMessage, Topics, topicOf } from "@ticketing/event-contracts";
import { ProblemException } from "@ticketing/common";
import { FinanceRepository } from "../finance.repository";

interface DeadRow {
  id: string;
  original_topic: string;
  message_id: string | null;
  payload: string | null;
  message_key: string | null;
  headers: Record<string, string[]>;
  status: string;
}

@Injectable()
export class DlqService {
  constructor(private readonly repo: FinanceRepository) {}

  async collect(topic: string, partition: number, message: KafkaMessage): Promise<void> {
    const headers: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(message.headers ?? {})) {
      if (value !== undefined)
        headers[key] = (Array.isArray(value) ? value : [value]).map((v) =>
          Buffer.from(v).toString("base64"),
        );
    }
    const original = topic.slice(0, -4);
    let id: string | null = null;
    try {
      id = parseMessage(JSON.parse(message.value?.toString("utf8") ?? "")).message_id;
    } catch {
      /* Payload thô vẫn được lưu để điều tra. */
    }
    const errorHeader = message.headers?.["x-error"];
    const error = errorHeader
      ? String(Array.isArray(errorHeader) ? errorHeader[0] : errorHeader)
      : "Unknown consumer failure";
    await this.repo.pool.query(
      `INSERT INTO dead_letters
      (id,topic,partition,"offset",original_topic,message_id,message_key,payload,headers,error)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) ON CONFLICT(topic,partition,"offset") DO NOTHING`,
      [
        randomUUID(),
        topic,
        partition,
        message.offset,
        original,
        id,
        message.key?.toString("base64") ?? null,
        message.value?.toString("base64") ?? null,
        JSON.stringify(headers),
        error,
      ],
    );
  }

  async list(cursor: string | undefined, limit: number) {
    const { rows } = await this.repo.pool.query(
      "SELECT * FROM dead_letters WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2",
      [cursor ?? null, limit + 1],
    );
    return {
      items: rows.slice(0, limit),
      next_cursor: rows.length > limit ? String(rows[limit - 1].id) : null,
    };
  }

  async replay(id: string) {
    return this.repo.db.transaction(async (e) => {
      const [row] = await e.query<DeadRow>(
        "SELECT * FROM dead_letters WHERE id=$1::uuid FOR UPDATE",
        [id],
      );
      if (!row) throw new ProblemException("DLQ_NOT_FOUND", 404, "Không có dead letter");
      if (row.status === "DISCARDED")
        throw new ProblemException("DLQ_DISCARDED", 409, "Dead letter đã discard");
      if (row.status === "REPLAY_PENDING" || row.status === "REPLAYED")
        return { id, status: row.status };
      // Chỉ replay schema hợp lệ vào topic hợp đồng đã biết; giữ nguyên từng byte envelope.
      let parsed;
      try {
        parsed = parseMessage(
          JSON.parse(Buffer.from(row.payload ?? "", "base64").toString("utf8")),
        );
      } catch {
        throw new ProblemException(
          "DLQ_INVALID_MESSAGE",
          409,
          "Payload sai schema; cần sửa producer và phát sự kiện hợp lệ",
        );
      }
      if (
        !Object.values(Topics).includes(row.original_topic as never) ||
        topicOf[parsed.type] !== row.original_topic ||
        parsed.message_id !== row.message_id
      )
        throw new ProblemException(
          "DLQ_INVALID_TOPIC",
          409,
          "Topic hoặc message_id không khớp hợp đồng",
        );
      await e.query(
        "INSERT INTO dlq_replays(id,dead_letter_id) VALUES($1::uuid,$2::uuid) RETURNING id",
        [randomUUID(), id],
      );
      await e.query(
        "UPDATE dead_letters SET status='REPLAY_PENDING',updated_at=now(),version=version+1 WHERE id=$1::uuid AND status='PENDING' RETURNING id",
        [id],
      );
      return { id, status: "REPLAY_PENDING" };
    });
  }

  async discard(id: string) {
    return this.repo.db.transaction(async (e) => {
      const [row] = await e.query<DeadRow>(
        "SELECT * FROM dead_letters WHERE id=$1::uuid FOR UPDATE",
        [id],
      );
      if (!row) throw new ProblemException("DLQ_NOT_FOUND", 404, "Không có dead letter");
      if (row.status === "REPLAY_PENDING" || row.status === "REPLAYED")
        throw new ProblemException("DLQ_REPLAY_STARTED", 409, "Replay đã bắt đầu");
      await e.query(
        "UPDATE dead_letters SET status='DISCARDED',updated_at=now(),version=version+1 WHERE id=$1::uuid AND status='PENDING' RETURNING id",
        [id],
      );
      return { id, status: "DISCARDED" };
    });
  }

  /** Relay outbox thô riêng cho DLQ: crash sau Kafka ack có thể gửi trùng, cùng message_id để Inbox chặn. */
  async relay(producer: Pick<Producer, "send">): Promise<void> {
    await this.repo.db.transaction(async (e) => {
      const rows = await e.query<
        DeadRow & { replay_id: string }
      >(`SELECT d.*,r.id AS replay_id FROM dlq_replays r
        JOIN dead_letters d ON d.id=r.dead_letter_id WHERE r.published_at IS NULL
        ORDER BY r.created_at,r.id FOR UPDATE OF r SKIP LOCKED LIMIT 50`);
      for (const row of rows) {
        const headers = Object.fromEntries(
          Object.entries(row.headers).map(([key, values]) => [
            key,
            values.map((v) => Buffer.from(v, "base64")),
          ]),
        );
        await producer.send({
          topic: row.original_topic,
          acks: -1,
          messages: [
            {
              key: row.message_key === null ? null : Buffer.from(row.message_key, "base64"),
              value: row.payload === null ? null : Buffer.from(row.payload, "base64"),
              headers,
            },
          ],
        });
        await e.query("UPDATE dlq_replays SET published_at=now() WHERE id=$1::uuid RETURNING id", [
          row.replay_id,
        ]);
        await e.query(
          "UPDATE dead_letters SET status='REPLAYED',updated_at=now(),version=version+1 WHERE id=$1::uuid AND status='REPLAY_PENDING' RETURNING id",
          [row.id],
        );
      }
    });
  }
}
