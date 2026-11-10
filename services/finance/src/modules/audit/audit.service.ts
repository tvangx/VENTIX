import { Injectable } from "@nestjs/common";
import { EventMessage } from "@ticketing/event-contracts";
import { SqlExecutor } from "@ticketing/outbox-inbox";
import { FinanceRepository } from "../finance.repository";
import { chainHash, GENESIS } from "./canonical";

interface AuditRow {
  id: string;
  record: Record<string, unknown>;
  prev_hash: string;
  hash: string;
  message_id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  before_state: unknown;
  after_state: unknown;
  created_at: Date;
}

@Injectable()
export class AuditService {
  constructor(private readonly repo: FinanceRepository) {}

  async append(exec: SqlExecutor, message: EventMessage<"AuditRecorded">): Promise<void> {
    // Một khóa cố định cho TOÀN chuỗi, lấy trước sequence/đọc tip để thứ tự id = thứ tự commit.
    await exec.query("SELECT pg_advisory_xact_lock(402, 1)");
    const duplicate = await exec.query("SELECT id FROM audit_logs WHERE message_id=$1::uuid", [
      message.message_id,
    ]);
    if (duplicate.length) return;
    const [tip] = await exec.query<{ hash: string }>(
      "SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1",
    );
    const [sequence] = await exec.query<{ id: string }>(
      "SELECT nextval(pg_get_serial_sequence('audit_logs','id'))::text AS id",
    );
    const created = new Date().toISOString();
    const d = message.data;
    const record = {
      id: sequence.id,
      message_id: message.message_id,
      actor_id: d.actor_id,
      action: d.action,
      resource_type: d.resource_type,
      resource_id: d.resource_id,
      before_state: d.before_state ?? null,
      after_state: d.after_state ?? null,
      created_at: created,
    };
    const previous = tip?.hash ?? GENESIS;
    await exec.query(
      `INSERT INTO audit_logs
      (id,message_id,actor_id,action,resource_type,resource_id,before_state,after_state,record,prev_hash,hash,created_at)
      VALUES ($1::bigint,$2::uuid,$3::uuid,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12::timestamptz) RETURNING id`,
      [
        sequence.id,
        message.message_id,
        d.actor_id,
        d.action,
        d.resource_type,
        d.resource_id,
        JSON.stringify(d.before_state ?? null),
        JSON.stringify(d.after_state ?? null),
        JSON.stringify(record),
        previous,
        chainHash(previous, record),
        created,
      ],
    );
  }

  async verify(): Promise<{ ok: boolean; checked: number; first_broken_id?: string }> {
    const { rows } = await this.repo.pool.query<AuditRow>("SELECT * FROM audit_logs ORDER BY id");
    let previous = GENESIS;
    let checked = 0;
    for (const row of rows) {
      checked++;
      const record = {
        id: row.id,
        message_id: row.message_id,
        actor_id: row.actor_id,
        action: row.action,
        resource_type: row.resource_type,
        resource_id: row.resource_id,
        before_state: row.before_state,
        after_state: row.after_state,
        created_at: row.created_at.toISOString(),
      };
      if (
        row.prev_hash !== previous ||
        chainHash(previous, record) !== row.hash ||
        chainHash(previous, row.record) !== row.hash
      )
        return { ok: false, checked, first_broken_id: row.id };
      previous = row.hash;
    }
    return { ok: true, checked };
  }

  async list(cursor: string | undefined, limit: number, action?: string, resourceType?: string) {
    const { rows } = await this.repo.pool.query(
      `SELECT id::text,message_id,actor_id,action,resource_type,resource_id,
      before_state,after_state,prev_hash,hash,created_at FROM audit_logs
      WHERE ($1::bigint IS NULL OR id > $1) AND ($3::text IS NULL OR action=$3)
      AND ($4::text IS NULL OR resource_type=$4) ORDER BY id LIMIT $2`,
      [cursor ?? null, limit + 1, action ?? null, resourceType ?? null],
    );
    return {
      items: rows.slice(0, limit),
      next_cursor: rows.length > limit ? String(rows[limit - 1].id) : null,
    };
  }
}
