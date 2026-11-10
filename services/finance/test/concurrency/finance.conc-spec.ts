import { randomUUID } from "node:crypto";
import { newMessage } from "@ticketing/event-contracts";
import { fixture } from "../support/finance";

describe("Finance concurrency 50 tác vụ", () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    f = await fixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  it("50 audit song song, chuỗi hợp lệ và phát hiện đúng dòng sửa bằng superuser", async () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      newMessage("AuditRecorded", {
        actor_id: null,
        action: `AUDIT_${i}`,
        resource_type: "test",
        resource_id: randomUUID(),
        after_state: { b: 2, a: 1 },
      }),
    );
    expect(await Promise.all(messages.map((m) => f.deliver(m)))).toEqual(
      Array(50).fill("processed"),
    );
    expect(await f.audit.verify()).toEqual({ ok: true, checked: 50 });
    const { rows } = await f.admin.query(
      "SELECT id::text FROM audit_logs ORDER BY audit_logs.id LIMIT 1 OFFSET 19",
    );
    const client = await f.admin.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE audit_logs DISABLE TRIGGER USER");
      await client.query("UPDATE audit_logs SET action='TAMPERED' WHERE id=$1", [rows[0].id]);
      await client.query("ALTER TABLE audit_logs ENABLE TRIGGER USER");
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
    expect(await f.audit.verify()).toEqual({ ok: false, checked: 20, first_broken_id: rows[0].id });
  });
  it("50 order khác nhau cùng event không mất cập nhật; 50 refund đưa stats về 0", async () => {
    const s = await f.seed();
    const orders = Array.from({ length: 50 }, () => ({
      ...s.order,
      message_id: randomUUID(),
      data: {
        ...s.order.data,
        order_id: randomUUID(),
        payment_id: randomUUID(),
        items: s.order.data.items.map((i) => ({ ...i, order_item_id: randomUUID() })),
      },
    }));
    expect(await Promise.all(orders.map((o) => f.deliver(o)))).toEqual(Array(50).fill("processed"));
    expect(
      (
        await f.repo.pool.query(
          "SELECT sold,revenue_vnd FROM event_sales_stats WHERE event_id=$1",
          [s.event],
        )
      ).rows,
    ).toEqual([{ sold: 50, revenue_vnd: "5500" }]);
    expect(
      await Promise.all(
        orders.map((o) =>
          f.deliver(
            newMessage("RefundCompleted", {
              refund_id: randomUUID(),
              payment_id: o.data.payment_id,
              order_id: o.data.order_id,
              amount_vnd: 220,
            }),
          ),
        ),
      ),
    ).toEqual(Array(50).fill("processed"));
    expect(
      (
        await f.repo.pool.query(
          "SELECT sold,revenue_vnd FROM event_sales_stats WHERE event_id=$1",
          [s.event],
        )
      ).rows,
    ).toEqual([{ sold: 0, revenue_vnd: "0" }]);
  });
  it("50 confirm cùng order với id message khác nhau và 50 refund chỉ tác động một lần", async () => {
    const s = await f.seed();
    expect(
      await Promise.all(
        Array.from({ length: 50 }, () => f.deliver({ ...s.order, message_id: randomUUID() })),
      ),
    ).toEqual(Array(50).fill("processed"));
    expect(await Promise.all(Array.from({ length: 50 }, () => f.deliver(s.refund())))).toEqual(
      Array(50).fill("processed"),
    );
    expect(
      (
        await f.repo.pool.query("SELECT * FROM ledger_entries WHERE ref_id=$1", [
          s.order.data.order_id,
        ])
      ).rowCount,
    ).toBe(10);
    expect(
      (
        await f.repo.pool.query(
          "SELECT sold,revenue_vnd FROM event_sales_stats WHERE event_id=$1",
          [s.event],
        )
      ).rows,
    ).toEqual([{ sold: 0, revenue_vnd: "0" }]);
  });
});
