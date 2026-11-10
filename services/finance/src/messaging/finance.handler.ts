import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { EventMessage, newMessage } from "@ticketing/event-contracts";
import { OutboxService, ParsedMessage, PermanentError, SqlExecutor } from "@ticketing/outbox-inbox";
import { ENV } from "../app.tokens";
import { Env } from "../config/env.schema";
import { AuditService } from "../modules/audit/audit.service";
import { digest } from "../modules/audit/canonical";
import { splitVat } from "../modules/ledger/vat";

type Item = EventMessage<"OrderConfirmed">["data"]["items"][number] & { ticket_class_id?: string };
interface Revenue {
  id: string;
  category: "TICKET" | "MERCH";
  event_id: string;
  gross_vnd: string;
  net_vnd: string;
  vat_vnd: string;
  items: Item[];
  reversed_at: Date | null;
}

@Injectable()
export class FinanceHandler {
  private readonly outbox = new OutboxService();
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  async handle(exec: SqlExecutor, message: ParsedMessage): Promise<void> {
    if (message.type === "AuditRecorded") return this.audit.append(exec, message);
    if (message.type === "EventApproved" || message.type === "EventUpdated") {
      const d = message.data;
      if (!("title" in d)) {
        // v1 update không đủ snapshot: không ghi đè tenant/title/phiên bản snapshot đã biết.
        const rows = await exec.query(
          "SELECT id FROM events_ref WHERE event_id=$1::uuid AND organizer_id=$2::uuid",
          [d.event_id, d.organizer_id],
        );
        if (!rows.length) throw new Error("EventApproved snapshot is not available");
        return;
      }
      const seatVersion = "seat_map_version" in d ? d.seat_map_version : 0;
      await exec.query(
        `INSERT INTO events_ref (id,event_id,organizer_id,title,event_version,seat_map_version,pricing_ready,ticket_classes)
        VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8::jsonb)
        ON CONFLICT (event_id) DO UPDATE SET organizer_id=EXCLUDED.organizer_id,title=EXCLUDED.title,
        event_version=EXCLUDED.event_version,seat_map_version=EXCLUDED.seat_map_version,
        pricing_ready=CASE WHEN events_ref.seat_map_version=EXCLUDED.seat_map_version THEN events_ref.pricing_ready ELSE EXCLUDED.pricing_ready END,
        ticket_classes=EXCLUDED.ticket_classes,updated_at=now(),version=events_ref.version+1
        WHERE events_ref.event_version < EXCLUDED.event_version RETURNING id`,
        [
          randomUUID(),
          d.event_id,
          d.organizer_id,
          d.title,
          d.event_version,
          seatVersion,
          !d.ticket_classes.some((c) => c.kind === "SEATED"),
          JSON.stringify(d.ticket_classes),
        ],
      );
      return;
    }
    if (message.type !== "OrderConfirmed" && message.type !== "RefundCompleted") return;
    const d = message.data;
    // Cùng order qua hai topic: serialize cả confirm/refund và các message_id khác nhau.
    await exec.query("SELECT pg_advisory_xact_lock(hashtextextended($1,402))", [d.order_id]);
    if (message.type === "OrderConfirmed") {
      await this.confirm(exec, message);
      const pending = await exec.query<{ message: EventMessage<"RefundCompleted"> }>(
        "SELECT message FROM pending_refunds WHERE order_id=$1::uuid ORDER BY created_at,id",
        [d.order_id],
      );
      for (const row of pending) await this.refund(exec, row.message);
      await exec.query("DELETE FROM pending_refunds WHERE order_id=$1::uuid RETURNING id", [
        d.order_id,
      ]);
    } else {
      const order = await exec.query("SELECT id FROM finance_orders WHERE id=$1::uuid", [
        d.order_id,
      ]);
      if (!order.length) {
        const refund = message.data;
        const existing = await exec.query<{ message: unknown }>(
          "SELECT message FROM pending_refunds WHERE id=$1::uuid",
          [refund.refund_id],
        );
        if (
          existing.length &&
          digest((existing[0].message as EventMessage<"RefundCompleted">).data) !== digest(refund)
        )
          throw new PermanentError("Conflicting refund payload");
        await exec.query(
          `INSERT INTO pending_refunds (id,order_id,payment_id,amount_vnd,message)
          VALUES ($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
          [
            refund.refund_id,
            refund.order_id,
            refund.payment_id,
            refund.amount_vnd,
            JSON.stringify(message),
          ],
        );
      } else await this.refund(exec, message);
    }
  }

  private async confirm(exec: SqlExecutor, message: EventMessage<"OrderConfirmed">) {
    const d = message.data;
    const prior = await exec.query<{ fingerprint: string }>(
      "SELECT fingerprint FROM finance_orders WHERE id=$1::uuid",
      [d.order_id],
    );
    if (prior.length) {
      if (prior[0].fingerprint !== digest(d))
        throw new PermanentError("Conflicting OrderConfirmed");
      return;
    }
    const [event] = await exec.query<{
      organizer_id: string;
      seat_map_version: number;
      pricing_ready: boolean;
      ticket_classes: { id: string }[];
    }>(
      "SELECT organizer_id,seat_map_version,pricing_ready,ticket_classes FROM events_ref WHERE event_id=$1::uuid FOR SHARE",
      [d.event_id],
    );
    if (!event) throw new Error("Event snapshot is not available");
    const items: Item[] = d.items.map((i) => ({ ...i }));
    for (const item of items) {
      if (item.item_type === "MERCH") continue;
      if (item.item_type === "TICKET_GA") item.ticket_class_id = item.ref_id;
      else {
        if (!event.pricing_ready) throw new Error("Seat mapping is not ready");
        const [seat] = await exec.query<{ ticket_class_id: string }>(
          "SELECT ticket_class_id FROM seat_classes WHERE event_id=$1::uuid AND seat_id=$2::uuid AND seat_map_version=$3",
          [d.event_id, item.ref_id, event.seat_map_version],
        );
        if (!seat) throw new Error("Seat class is not available");
        item.ticket_class_id = seat.ticket_class_id;
      }
      if (!event.ticket_classes.some((c) => c.id === item.ticket_class_id))
        throw new PermanentError("Unknown ticket class");
      if (!Number.isSafeInteger(item.quantity * item.unit_price_vnd))
        throw new PermanentError("Unsafe item amount");
    }
    const txn = randomUUID();
    await exec.query(
      "INSERT INTO finance_orders (id,event_id,payment_id,fingerprint) VALUES ($1::uuid,$2::uuid,$3::uuid,$4) RETURNING id",
      [d.order_id, d.event_id, d.payment_id, digest(d)],
    );
    await exec.query(
      "INSERT INTO ledger_transactions (id,order_id,kind) VALUES ($1::uuid,$2::uuid,'SALE') RETURNING id",
      [txn, d.order_id],
    );
    const total = splitVat(d.total_amount_vnd, 0).gross;
    await this.entry(exec, txn, "PROVIDER_RECEIVABLE", total, 0n, d.order_id);
    for (const category of ["TICKET", "MERCH"] as const) {
      const rate = category === "TICKET" ? this.env.VAT_RATE_TICKET : this.env.VAT_RATE_MERCH;
      const amounts = splitVat(
        category === "TICKET" ? d.ticket_amount_vnd : d.merch_amount_vnd,
        rate,
      );
      const selected = items.filter((i) => (i.item_type === "MERCH") === (category === "MERCH"));
      await exec.query(
        `INSERT INTO revenue_records (id,order_id,organizer_id,event_id,category,gross_vnd,net_vnd,vat_rate,vat_vnd,items)
        VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::bigint,$7::bigint,$8,$9::bigint,$10::jsonb) RETURNING id`,
        [
          randomUUID(),
          d.order_id,
          event.organizer_id,
          d.event_id,
          category,
          amounts.gross.toString(),
          amounts.net.toString(),
          rate,
          amounts.vat.toString(),
          JSON.stringify(selected),
        ],
      );
      await this.entry(exec, txn, `REVENUE_${category}`, 0n, amounts.net, d.order_id);
      await this.entry(exec, txn, `VAT_PAYABLE_${category}`, 0n, amounts.vat, d.order_id);
      await this.stats(exec, d.event_id, category, amounts, selected, 1);
    }
  }

  private async refund(exec: SqlExecutor, message: EventMessage<"RefundCompleted">) {
    const d = message.data;
    const rows = await exec.query<Revenue>(
      "SELECT * FROM revenue_records WHERE order_id=$1::uuid ORDER BY CASE category WHEN 'TICKET' THEN 0 ELSE 1 END FOR UPDATE",
      [d.order_id],
    );
    const [order] = await exec.query<{ payment_id: string }>(
      "SELECT payment_id FROM finance_orders WHERE id=$1::uuid",
      [d.order_id],
    );
    const total = rows.reduce((a, r) => a + BigInt(r.gross_vnd), 0n);
    if (
      !Number.isSafeInteger(d.amount_vnd) ||
      total !== BigInt(d.amount_vnd) ||
      order.payment_id !== d.payment_id
    ) {
      await this.outbox.add(
        exec,
        newMessage(
          "AuditRecorded",
          {
            actor_id: null,
            action: "REFUND_AMOUNT_MISMATCH",
            resource_type: "order",
            resource_id: d.order_id,
            after_state: {
              refund_id: d.refund_id,
              expected_vnd: total.toString(),
              received_vnd: String(d.amount_vnd),
              payment_matches: order.payment_id === d.payment_id,
            },
          },
          { trace_id: message.trace_id },
        ),
        d.order_id,
      );
      return;
    }
    if (rows.every((r) => r.reversed_at !== null)) return;
    const txn = randomUUID();
    await exec.query(
      "INSERT INTO ledger_transactions (id,order_id,kind) VALUES ($1::uuid,$2::uuid,'REFUND') RETURNING id",
      [txn, d.order_id],
    );
    await this.entry(exec, txn, "PROVIDER_RECEIVABLE", 0n, total, d.order_id);
    for (const row of rows) {
      const amounts = {
        gross: BigInt(row.gross_vnd),
        net: BigInt(row.net_vnd),
        vat: BigInt(row.vat_vnd),
      };
      await this.entry(exec, txn, `REVENUE_${row.category}`, amounts.net, 0n, d.order_id);
      await this.entry(exec, txn, `VAT_PAYABLE_${row.category}`, amounts.vat, 0n, d.order_id);
      await this.stats(exec, row.event_id, row.category, amounts, row.items, -1);
    }
    await exec.query(
      "UPDATE revenue_records SET reversed_at=now(),updated_at=now(),version=version+1 WHERE order_id=$1::uuid AND reversed_at IS NULL RETURNING id",
      [d.order_id],
    );
  }

  private async entry(
    exec: SqlExecutor,
    txn: string,
    account: string,
    debit: bigint,
    credit: bigint,
    order: string,
  ) {
    await exec.query(
      `INSERT INTO ledger_entries (id,txn_id,account,debit_vnd,credit_vnd,ref_type,ref_id)
      VALUES ($1::uuid,$2::uuid,$3,$4::bigint,$5::bigint,'ORDER',$6::uuid) RETURNING id`,
      [randomUUID(), txn, account, debit.toString(), credit.toString(), order],
    );
  }

  private async stats(
    exec: SqlExecutor,
    event: string,
    category: string,
    amounts: { gross: bigint; net: bigint; vat: bigint },
    items: Item[],
    sign: number,
  ) {
    if (sign < 0) {
      const revenue = await exec.query(
        `UPDATE event_revenue_stats SET gross_vnd=gross_vnd-$3::bigint,
        net_vnd=net_vnd-$4::bigint,vat_vnd=vat_vnd-$5::bigint,updated_at=now(),version=version+1
        WHERE event_id=$1::uuid AND category=$2 RETURNING id`,
        [event, category, amounts.gross.toString(), amounts.net.toString(), amounts.vat.toString()],
      );
      if (revenue.length !== 1) throw new Error("Revenue stats missing during refund");
      for (const item of [...items].sort((a, b) =>
        (a.ticket_class_id ?? "").localeCompare(b.ticket_class_id ?? ""),
      )) {
        if (!item.ticket_class_id) continue;
        const sale = await exec.query(
          `UPDATE event_sales_stats SET sold=sold-$3,revenue_vnd=revenue_vnd-$4::bigint,
          updated_at=now(),version=version+1 WHERE event_id=$1::uuid AND ticket_class_id=$2::uuid RETURNING id`,
          [
            event,
            item.ticket_class_id,
            item.quantity,
            (BigInt(item.unit_price_vnd) * BigInt(item.quantity)).toString(),
          ],
        );
        if (sale.length !== 1) throw new Error("Sales stats missing during refund");
      }
      return;
    }
    await exec.query(
      `INSERT INTO event_revenue_stats (id,event_id,category,gross_vnd,net_vnd,vat_vnd)
      VALUES ($1::uuid,$2::uuid,$3,$4::bigint,$5::bigint,$6::bigint) ON CONFLICT (event_id,category) DO UPDATE SET
      gross_vnd=event_revenue_stats.gross_vnd+EXCLUDED.gross_vnd,net_vnd=event_revenue_stats.net_vnd+EXCLUDED.net_vnd,
      vat_vnd=event_revenue_stats.vat_vnd+EXCLUDED.vat_vnd,updated_at=now(),version=event_revenue_stats.version+1 RETURNING id`,
      [
        randomUUID(),
        event,
        category,
        (amounts.gross * BigInt(sign)).toString(),
        (amounts.net * BigInt(sign)).toString(),
        (amounts.vat * BigInt(sign)).toString(),
      ],
    );
    for (const i of [...items].sort((a, b) =>
      (a.ticket_class_id ?? "").localeCompare(b.ticket_class_id ?? ""),
    )) {
      if (!i.ticket_class_id) continue;
      await exec.query(
        `INSERT INTO event_sales_stats (id,event_id,ticket_class_id,sold,revenue_vnd)
        VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::bigint) ON CONFLICT (event_id,ticket_class_id) DO UPDATE SET
        sold=event_sales_stats.sold+EXCLUDED.sold,revenue_vnd=event_sales_stats.revenue_vnd+EXCLUDED.revenue_vnd,
        updated_at=now(),version=event_sales_stats.version+1 RETURNING id`,
        [
          randomUUID(),
          event,
          i.ticket_class_id,
          i.quantity * sign,
          (BigInt(i.unit_price_vnd) * BigInt(i.quantity) * BigInt(sign)).toString(),
        ],
      );
    }
  }
}
