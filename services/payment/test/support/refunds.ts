import { randomUUID } from "node:crypto";
import { InboxProcessor } from "@ticketing/outbox-inbox";
import { newMessage } from "@ticketing/event-contracts";
import { refundHandler } from "../../src/modules/refunds/refund.handler";
import { Fixture } from "./payment";

export function refundInbox(f: Fixture) {
  return new InboxProcessor({
    db: f.repo.db,
    consumerName: "test-refunds",
    handler: refundHandler,
    maxAttempts: 1,
    deadLetter: async (letter) => {
      throw new Error(`Refund DLQ: ${letter.error}`);
    },
  });
}
export async function seedRefundBatch(
  f: Fixture,
  count: number,
  eventId = randomUUID(),
  organizer = randomUUID(),
) {
  const inputs = Array.from({ length: count }, () => ({
    id: randomUUID(),
    order: randomUUID(),
    user: randomUUID(),
  }));
  await f.repo.pool.query(
    `INSERT INTO payments(id,purpose,ref_id,user_id,event_id,provider,amount_vnd,status,idempotency_key,request_hash,redirect_url,expires_at,paid_at,trace_id,mock_data)
    SELECT id,'ORDER',"order","user",$2::uuid,'MOCK',100000,'SUCCEEDED',id::text,repeat('a',64),
      'https://mock.invalid/payments/'||id::text,now()+interval '15 minutes',now(),'refund-batch-test','{}'::jsonb
    FROM jsonb_to_recordset($1::jsonb) AS t(id uuid,"order" uuid,"user" uuid)`,
    [JSON.stringify(inputs), eventId],
  );
  const message = newMessage(
    "EventCancelled",
    { event_id: eventId, organizer_id: organizer, event_version: 1, reason: "test" },
    { version: 2, tenant_id: organizer, trace_id: "batch-trace" },
  );
  const inbox = refundInbox(f);
  expect(await inbox.process(f.record(message, "event.lifecycle"))).toBe("processed");
  expect(await inbox.process(f.record(message, "event.lifecycle"))).toBe("duplicate");
  const [batch] = (
    await f.repo.pool.query<{ id: string }>(
      "SELECT id FROM refund_batches WHERE event_id=$1 AND automatic=true",
      [eventId],
    )
  ).rows;
  return { eventId, organizer, inputs, batchId: batch.id, message };
}
