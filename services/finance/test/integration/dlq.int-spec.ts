import { randomUUID } from "node:crypto";
import { newMessage } from "@ticketing/event-contracts";
import { KafkaMessage } from "kafkajs";
import request from "supertest";
import { DlqService } from "../../src/modules/dlq/dlq.service";
import { fixture } from "../support/finance";

describe("DLQ và audit admin (Postgres)", () => {
  let f: Awaited<ReturnType<typeof fixture>>, dlq: DlqService;
  beforeAll(async () => {
    f = await fixture();
    dlq = f.app.get(DlqService);
  });
  afterAll(async () => {
    await f?.close();
  });
  const message = (payload: Buffer): KafkaMessage => ({
    offset: "0",
    key: Buffer.from([0, 255, 32]),
    value: payload,
    timestamp: "0",
    attributes: 0,
    headers: {
      "x-error": Buffer.from("Synthetic failure"),
      "x-original-topic": Buffer.from("audit.events"),
    },
  });
  it("collector idempotent, replay qua outbox giữ nguyên bytes/message_id, lỗi relay rollback trạng thái", async () => {
    const event = newMessage("AuditRecorded", {
      actor_id: null,
      action: "DLQ_TEST",
      resource_type: "test",
      resource_id: randomUUID(),
    });
    const raw = Buffer.from(JSON.stringify(event));
    const topic = "audit.events.dlq";
    await dlq.collect(topic, 0, message(raw));
    await dlq.collect(topic, 0, message(raw));
    const { rows } = await f.repo.pool.query("SELECT * FROM dead_letters WHERE message_id=$1", [
      event.message_id,
    ]);
    expect(rows).toHaveLength(1);
    const id = rows[0].id;
    const admin = await f.token(["ADMIN"]);
    const api = request(f.app.getHttpServer());
    await api
      .post(`/v1/admin/dlq/${id}/replay`)
      .set("Authorization", `Bearer ${await f.token(["ORGANIZER"])}`)
      .expect(403);
    await api
      .post(`/v1/admin/dlq/${id}/replay`)
      .set("Authorization", `Bearer ${admin}`)
      .expect(201, { id, status: "REPLAY_PENDING" });
    await api
      .post(`/v1/admin/dlq/${id}/replay`)
      .set("Authorization", `Bearer ${admin}`)
      .expect(201, { id, status: "REPLAY_PENDING" });
    await expect(
      dlq.relay({
        send: async () => {
          throw new Error("broker unavailable");
        },
      }),
    ).rejects.toThrow("broker unavailable");
    expect(
      (
        await f.repo.pool.query("SELECT published_at FROM dlq_replays WHERE dead_letter_id=$1", [
          id,
        ])
      ).rows[0].published_at,
    ).toBeNull();
    const send = jest.fn().mockResolvedValue([]);
    await dlq.relay({ send });
    const sent = send.mock.calls[0][0];
    expect(sent.topic).toBe("audit.events");
    expect(sent.acks).toBe(-1);
    expect(sent.messages[0].value.equals(raw)).toBe(true);
    expect(sent.messages[0].key.equals(message(raw).key)).toBe(true);
    expect(JSON.parse(sent.messages[0].value.toString()).message_id).toBe(event.message_id);
    await dlq.relay({ send });
    expect(send).toHaveBeenCalledTimes(1);
    await expect(dlq.discard(id)).rejects.toMatchObject({ code: "DLQ_REPLAY_STARTED" });
  });
  it("invalid JSON lưu nguyên bản; replay từ chối; discard idempotent; API phân trang/role", async () => {
    await dlq.collect("booking.orders.dlq", 1, { ...message(Buffer.from("{broken")), offset: "9" });
    const { rows } = await f.repo.pool.query(
      "SELECT id FROM dead_letters WHERE topic='booking.orders.dlq'",
    );
    const id = rows[0].id;
    await expect(dlq.replay(id)).rejects.toMatchObject({ code: "DLQ_INVALID_MESSAGE" });
    expect(await dlq.discard(id)).toEqual({ id, status: "DISCARDED" });
    expect(await dlq.discard(id)).toEqual({ id, status: "DISCARDED" });
    await expect(dlq.replay(id)).rejects.toMatchObject({ code: "DLQ_DISCARDED" });
    const token = await f.token(["ADMIN"]);
    const api = request(f.app.getHttpServer());
    const page = await api
      .get("/v1/admin/dlq?limit=1")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.next_cursor).toBeTruthy();
    await api.get("/v1/admin/dlq?limit=0").set("Authorization", `Bearer ${token}`).expect(400);
    await api
      .get("/v1/admin/audit")
      .set("Authorization", `Bearer ${await f.token(["USER"])}`)
      .expect(403);
  });
  it("audit list cursor/filter và verify trả JSON hợp lệ, không biến bigint thành number", async () => {
    for (let i = 0; i < 3; i++)
      await f.deliver(
        newMessage("AuditRecorded", {
          actor_id: null,
          action: "FILTER_TEST",
          resource_type: "test",
          resource_id: randomUUID(),
        }),
      );
    const token = await f.token(["ADMIN"]);
    const api = request(f.app.getHttpServer());
    const first = await api
      .get("/v1/admin/audit?limit=2&action=FILTER_TEST")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(first.body.items).toHaveLength(2);
    expect(typeof first.body.next_cursor).toBe("string");
    const second = await api
      .get(`/v1/admin/audit?cursor=${first.body.next_cursor}&action=FILTER_TEST`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.next_cursor).toBeNull();
    await api
      .get("/v1/admin/audit/verify")
      .set("Authorization", `Bearer ${token}`)
      .expect(200, { ok: true, checked: 3 });
  });
});
