import { randomUUID } from "node:crypto";
import { parseMessage, Topics } from "@ticketing/event-contracts";
import { startKafka } from "../../../ticket/test/support/kafka";
import { kycFixture } from "../helpers/kyc";

describe("S-305 Identity Outbox relay", () => {
  it("publishes the committed verification audit to Kafka", async () => {
    const broker = await startKafka();
    const admin = broker.kafka.admin();
    await admin.connect();
    await admin.createTopics({
      topics: [{ topic: Topics.AUDIT_EVENTS, numPartitions: 1 }],
      waitForLeaders: true,
    });
    await admin.disconnect();
    const context = await kycFixture({
      IDENTITY_OUTBOX_ENABLED: "true",
      KAFKA_BROKERS: broker.brokers.join(","),
    });
    const observer = broker.kafka.consumer({ groupId: `kyc-audit-${randomUUID()}` });
    const audits: ReturnType<typeof parseMessage>[] = [];
    try {
      await observer.connect();
      await observer.subscribe({ topic: Topics.AUDIT_EVENTS, fromBeginning: true });
      await observer.run({
        eachMessage: async ({ message }) => {
          audits.push(parseMessage(JSON.parse(message.value!.toString())));
        },
      });
      const user = await context.user();
      const challenge = await context.challenge(user.token, "001099000301").expect(201);
      await context
        .verify(user.token, challenge.body.challenge_id, await context.latestCode(user.email))
        .expect(200);
      const deadline = Date.now() + 30000;
      while (
        !audits.some(
          (message) => message.type === "AuditRecorded" && message.data.resource_id === user.id,
        ) ||
        (
          await context.pool.query(
            "SELECT * FROM outbox_events WHERE message_key=$1 AND published_at IS NOT NULL",
            [user.id],
          )
        ).rowCount !== 1
      ) {
        if (Date.now() > deadline) throw new Error("Committed KYC audit not relayed");
        await new Promise((accept) => setTimeout(accept, 25));
      }
      const event = audits.find((message) => message.type === "AuditRecorded");
      expect(event?.data).toMatchObject({
        action: "KYC_VERIFIED",
        resource_id: user.id,
        after_state: { verified: true },
      });
    } finally {
      await observer.disconnect();
      await context.close();
      await broker.stop();
    }
  });
});
