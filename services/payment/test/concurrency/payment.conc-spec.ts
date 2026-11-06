import { randomUUID } from "node:crypto";
import { fixture, Fixture } from "../support/payment";

describe("payment concurrency (50 contenders)", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });
  afterAll(async () => {
    await f?.close();
  });
  it("50 identical keys create one payment and replay one URL", async () => {
    const s = await f.seed(),
      key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => f.post(s.user, s.order, key)),
    );
    expect(results.map((r) => r.status)).toEqual(Array(50).fill(201));
    expect(new Set(results.map((r) => r.body.redirect_url)).size).toBe(1);
    expect(
      (await f.repo.pool.query("SELECT * FROM payments WHERE ref_id=$1", [s.order])).rows,
    ).toHaveLength(1);
  });
  it("50 different keys allow one active payment; callbacks racing write once", async () => {
    const s = await f.seed();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => f.post(s.user, s.order, randomUUID())),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 409 && r.body.code === "PAYMENT_ALREADY_ACTIVE"),
    ).toHaveLength(49);
    const p = await f.row(s.order),
      n = f.service.mock.verifyIpn(p.mock_data.notification)!;
    const codes = await Promise.all(
      Array.from({ length: 50 }, () => f.service.receive("MOCK", n, "concurrency-test")),
    );
    expect(codes.filter((c) => c === "00")).toHaveLength(1);
    expect(codes.filter((c) => c === "02")).toHaveLength(49);
    expect(
      (await f.repo.pool.query("SELECT * FROM payment_transactions WHERE payment_id=$1", [p.id]))
        .rows,
    ).toHaveLength(1);
    expect(
      (await f.repo.pool.query("SELECT * FROM outbox_events WHERE message_key=$1", [s.order])).rows,
    ).toHaveLength(1);
  });
  it("DB index rejects a second active writer even outside service locks", async () => {
    const s = await f.seed();
    await f.post(s.user, s.order, randomUUID());
    const p = await f.row(s.order);
    await expect(
      f.repo.pool.query(
        "INSERT INTO payments SELECT $1::uuid,purpose,ref_id,user_id,event_id,provider,amount_vnd,status,$2,request_hash,redirect_url,expires_at,paid_at,trace_id,mock_data,created_at,updated_at,version FROM payments WHERE id=$3",
        [randomUUID(), randomUUID(), p.id],
      ),
    ).rejects.toMatchObject({ code: "23505", constraint: "uq_payments_active" });
  });
});
