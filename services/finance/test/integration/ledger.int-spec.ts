import { randomUUID } from "node:crypto";
import request from "supertest";
import { newMessage } from "@ticketing/event-contracts";
import { fixture } from "../support/finance";

describe("Finance ledger, VAT, Inbox và tenant (PostgreSQL thật)", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    f = await fixture(true);
  });
  afterAll(async () => {
    await f?.close();
  });

  it("commit nhóm lệch thất bại; nhóm cân bằng được sealed và không nối thêm", async () => {
    const id = randomUUID(),
      order = randomUUID();
    await expect(
      f.repo.db.transaction(async (e) => {
        await e.query("INSERT INTO ledger_transactions(id,order_id,kind) VALUES($1,$2,'SALE')", [
          id,
          order,
        ]);
        await e.query(
          "INSERT INTO ledger_entries(id,txn_id,account,debit_vnd,credit_vnd,ref_type,ref_id) VALUES($1,$2,'PROVIDER_RECEIVABLE',100,0,'ORDER',$3)",
          [randomUUID(), id, order],
        );
      }),
    ).rejects.toThrow(/unbalanced/i);
    expect(
      (await f.repo.pool.query("SELECT * FROM ledger_transactions WHERE id=$1", [id])).rowCount,
    ).toBe(0);
    const s = await f.seed();
    expect(await f.deliver(s.order)).toBe("processed");
    const { rows } = await f.repo.pool.query(
      "SELECT * FROM ledger_transactions WHERE order_id=$1",
      [s.order.data.order_id],
    );
    expect(rows[0].created_xid).toMatch(/^\d+$/);
    await expect(
      f.repo.pool.query(
        "INSERT INTO ledger_entries(id,txn_id,account,debit_vnd,credit_vnd,ref_type,ref_id) VALUES($1,$2,'REVENUE_TICKET',0,0,'ORDER',$3)",
        [randomUUID(), rows[0].id, s.order.data.order_id],
      ),
    ).rejects.toThrow(/sealed/i);
  });

  it("SQL trực tiếp finance_user không UPDATE/DELETE/TRUNCATE ledger và audit", async () => {
    for (const table of ["ledger_entries", "audit_logs"])
      for (const sql of [`UPDATE ${table} SET id=id`, `DELETE FROM ${table}`, `TRUNCATE ${table}`])
        await expect(f.repo.pool.query(sql)).rejects.toThrow(/permission denied|append.only/i);
    // Có quyền DML nhưng trigger vẫn chặn, kể cả migration owner; không sửa dữ liệu thật.
    const s = await f.seed();
    await f.deliver(s.order);
    await f.deliver(
      newMessage("AuditRecorded", {
        actor_id: null,
        action: "TEST",
        resource_type: "order",
        resource_id: s.order.data.order_id,
      }),
    );
    for (const table of ["ledger_entries", "audit_logs"]) {
      await expect(f.admin.query(`UPDATE ${table} SET id=id`)).rejects.toThrow(/append.only/i);
      await expect(f.admin.query(`DELETE FROM ${table}`)).rejects.toThrow(/append.only/i);
      await expect(f.admin.query(`TRUNCATE ${table}`)).rejects.toThrow(/append.only/i);
    }
  });

  it("message trùng và business duplicate chỉ ghi một lần; refund đảo và số bán về 0", async () => {
    const s = await f.seed();
    expect(await f.deliver(s.order)).toBe("processed");
    expect(await f.deliver(s.order)).toBe("duplicate");
    expect(await f.deliver({ ...s.order, message_id: randomUUID() })).toBe("processed");
    expect(
      (
        await f.repo.pool.query("SELECT * FROM ledger_entries WHERE ref_id=$1", [
          s.order.data.order_id,
        ])
      ).rowCount,
    ).toBe(5);
    const refund = s.refund();
    await f.deliver(refund);
    await f.deliver(refund);
    await f.deliver(s.refund());
    expect(
      (
        await f.repo.pool.query("SELECT * FROM ledger_entries WHERE ref_id=$1", [
          s.order.data.order_id,
        ])
      ).rowCount,
    ).toBe(10);
    const { rows } = await f.repo.pool.query(
      "SELECT sold,revenue_vnd FROM event_sales_stats WHERE event_id=$1",
      [s.event],
    );
    expect(rows).toEqual([{ sold: 0, revenue_vnd: "0" }]);
    expect(
      (
        await f.repo.pool.query(
          "SELECT * FROM event_revenue_stats WHERE event_id=$1 AND (gross_vnd<>0 OR net_vnd<>0 OR vat_vnd<>0)",
          [s.event],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await f.repo.pool.query(
          "SELECT txn_id FROM ledger_entries GROUP BY txn_id HAVING sum(debit_vnd)<>sum(credit_vnd)",
        )
      ).rowCount,
    ).toBe(0);
    const { rows: totals } = await f.repo.pool.query(
      "SELECT sum(credit_vnd-debit_vnd)::text AS revenue FROM ledger_entries WHERE ref_id=$1 AND account LIKE 'REVENUE_%'",
      [s.order.data.order_id],
    );
    expect(totals[0].revenue).toBe("0");
  });

  it("refund sai tổng không đảo và ghi AuditRecorded qua Outbox", async () => {
    const s = await f.seed();
    await f.deliver(s.order);
    await f.deliver(s.refund(219));
    expect(
      (
        await f.repo.pool.query(
          "SELECT * FROM revenue_records WHERE order_id=$1 AND reversed_at IS NOT NULL",
          [s.order.data.order_id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await f.repo.pool.query(
          "SELECT * FROM outbox_events WHERE payload->'data'->>'resource_id'=$1 AND event_type='AuditRecorded'",
          [s.order.data.order_id],
        )
      ).rowCount,
    ).toBe(1);
  });

  it("refund đến trước confirm được lưu và áp dụng khi đủ dữ liệu", async () => {
    const s = await f.seed();
    expect(await f.deliver(s.refund())).toBe("processed");
    expect(await f.deliver(s.order)).toBe("processed");
    expect(
      (await f.repo.pool.query("SELECT sold FROM event_sales_stats WHERE event_id=$1", [s.event]))
        .rows[0].sold,
    ).toBe(0);
  });

  it("Organizer A bị 403 với event B; owner và ADMIN xem được cùng snapshot", async () => {
    const s = await f.seed();
    await f.deliver(s.order);
    const path = `/v1/organizer/events/${s.event}/stats`;
    await request(f.app.getHttpServer())
      .get(path)
      .set("Authorization", `Bearer ${await f.token(["ORGANIZER"], randomUUID())}`)
      .expect(403);
    const result = await request(f.app.getHttpServer())
      .get(path)
      .set("Authorization", `Bearer ${await f.token(["ORGANIZER"], s.organizer)}`)
      .expect(200);
    expect(result.body.sales[0]).toMatchObject({ sold: 1, revenue_vnd: "110" });
    await request(f.app.getHttpServer())
      .get(path)
      .set("Authorization", `Bearer ${await f.token(["ADMIN"])}`)
      .expect(200);
    await request(f.app.getHttpServer())
      .get(path)
      .set("Authorization", `Bearer ${await f.token(["USER"])}`)
      .expect(403);
  });
});
