import { Injectable } from "@nestjs/common";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService } from "@ticketing/outbox-inbox";
import { Env } from "../../config/env.schema";
import { FinanceRepository } from "../finance.repository";
import { InvoiceInput } from "./invoice-adapter";

export interface InvoiceJob extends InvoiceInput {
  version: number;
  retry_count: number;
}

@Injectable()
export class InvoiceRepository {
  private readonly outbox = new OutboxService();
  constructor(private readonly repo: FinanceRepository) {}

  async materialize(): Promise<void> {
    // CTE nguyên tử: chỉ order đã commit qua Finance Inbox; PK order UUID chống replay.
    // Không đụng invoice của writer khác, không tính lại tiền/VAT hay sửa sổ cái.
    await this.repo.pool.query(`WITH inserted AS (
      INSERT INTO invoices(id,order_id,provider,status)
      SELECT o.id,o.id,'MOCK','PENDING' FROM finance_orders o
      WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id=o.id)
        AND EXISTS (SELECT 1 FROM revenue_records r WHERE r.order_id=o.id)
      ORDER BY o.created_at,o.id LIMIT 50 ON CONFLICT(id) DO NOTHING RETURNING id,order_id
    ) INSERT INTO invoice_items(id,invoice_id,category,vat_rate,amount_vnd)
      SELECT gen_random_uuid(),i.id,r.category,r.vat_rate,r.gross_vnd
      FROM inserted i JOIN revenue_records r ON r.order_id=i.order_id`);
  }

  async claim(env: Env): Promise<InvoiceJob | undefined> {
    return this.repo.db.transaction(async (e) => {
      // Crash ở lần cuối cũng phải đi tới FAILED sau khi lease hết hạn.
      await e.query(
        `UPDATE invoices SET status='FAILED',version=version+1,updated_at=now()
        WHERE provider='MOCK' AND retry_count >= $1 AND
        ((status='ISSUING' AND updated_at <= now()-$2*interval '1 millisecond')
        OR status='PENDING') RETURNING id`,
        [env.INVOICE_MAX_ATTEMPTS, env.INVOICE_LEASE_MS],
      );
      const [job] = await e.query<InvoiceJob>(
        `WITH candidate AS (
        SELECT id FROM invoices WHERE provider='MOCK' AND retry_count < $1
        AND ((status='PENDING' AND updated_at<=now())
          OR (status='ISSUING' AND updated_at<=now()-$2*interval '1 millisecond'))
        ORDER BY updated_at,id FOR UPDATE SKIP LOCKED LIMIT 1
      ) UPDATE invoices i SET status='ISSUING',retry_count=i.retry_count+1,
        version=i.version+1,updated_at=now() FROM candidate c WHERE i.id=c.id
        RETURNING i.id,i.order_id,i.version,i.retry_count`,
        [env.INVOICE_MAX_ATTEMPTS, env.INVOICE_LEASE_MS],
      );
      if (!job) return undefined;
      job.items = await e.query<InvoiceInput["items"][number]>(
        "SELECT category,amount_vnd::text,vat_rate::text FROM invoice_items WHERE invoice_id=$1 ORDER BY category,id",
        [job.id],
      );
      if (!job.items.length) throw new Error("Invoice snapshot is empty");
      return job;
    });
  }

  async complete(job: InvoiceJob, invoiceNo: string, env: Env): Promise<boolean> {
    return this.repo.db.transaction(async (e) => {
      const rows = await e.query(
        `UPDATE invoices SET status='ISSUED',invoice_no=$3,
        version=version+1,updated_at=now() WHERE id=$1 AND version=$2 AND status='ISSUING'
        AND updated_at>now()-$4*interval '1 millisecond' RETURNING id`,
        [job.id, job.version, invoiceNo, env.INVOICE_LEASE_MS],
      );
      if (!rows.length) return false;
      await this.outbox.add(
        e,
        newMessage(
          "AuditRecorded",
          {
            actor_id: null,
            action: "MOCK_INVOICE_ISSUED",
            resource_type: "invoice",
            resource_id: job.id,
            after_state: { provider: "MOCK", order_id: job.order_id, invoice_no: invoiceNo },
          },
          { trace_id: job.id },
        ),
        job.id,
      );
      return true;
    });
  }

  async fail(job: InvoiceJob, env: Env): Promise<boolean> {
    const terminal = job.retry_count >= env.INVOICE_MAX_ATTEMPTS;
    const delay = Math.min(
      env.INVOICE_RETRY_MAX_MS,
      env.INVOICE_RETRY_BASE_MS * 2 ** (job.retry_count - 1),
    );
    const jitter = Math.floor(Math.random() * Math.max(1, delay / 4));
    const result = await this.repo.pool.query(
      `UPDATE invoices SET status=$3,version=version+1,
      updated_at=now()+$4*interval '1 millisecond' WHERE id=$1 AND version=$2 AND status='ISSUING'
      AND updated_at>now()-$5*interval '1 millisecond' RETURNING id`,
      [
        job.id,
        job.version,
        terminal ? "FAILED" : "PENDING",
        terminal ? 0 : Math.min(env.INVOICE_RETRY_MAX_MS, delay + jitter),
        env.INVOICE_LEASE_MS,
      ],
    );
    return result.rowCount === 1;
  }
}
