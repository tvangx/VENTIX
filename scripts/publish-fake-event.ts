import { createRequire } from "node:module";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
// Dùng các dependency đã khai báo ở booking, không thêm dependency vào workspace root.
const bookingRequire = createRequire(join(process.cwd(), "package.json"));
const { Kafka, logLevel } = bookingRequire(
  "kafkajs",
) as typeof import("../services/booking/node_modules/kafkajs");
const { newMessage, parseMessage, topicOf } = bookingRequire(
  "@ticketing/event-contracts",
) as typeof import("../services/booking/node_modules/@ticketing/event-contracts");
const { z } = bookingRequire("zod") as typeof import("../services/booking/node_modules/zod");

async function publishFakeEvent(): Promise<void> {
  const config = z
    .object({
      KAFKA_BROKERS: z.string().min(1).default("localhost:9092"),
      FAKE_EVENT_ID: z.string().uuid().default(randomUUID()),
      FAKE_ORGANIZER_ID: z.string().uuid().default(randomUUID()),
      FAKE_CLASS_ID: z.string().uuid().default(randomUUID()),
      FAKE_EVENT_VERSION: z.coerce.number().int().nonnegative().default(1),
      FAKE_SEAT_MAP_VERSION: z.coerce.number().int().nonnegative().default(1),
    })
    .parse(process.env);
  const now = Date.now();
  const message = parseMessage(
    newMessage(
      "EventApproved",
      {
        event_id: config.FAKE_EVENT_ID,
        organizer_id: config.FAKE_ORGANIZER_ID,
        title: "T-203 synthetic development event",
        event_version: config.FAKE_EVENT_VERSION,
        seat_map_version: config.FAKE_SEAT_MAP_VERSION,
        start_at: new Date(now + 86400000).toISOString(),
        end_at: new Date(now + 90000000).toISOString(),
        ticket_classes: [
          {
            id: config.FAKE_CLASS_ID,
            name: "Synthetic seated",
            price_vnd: 100000,
            capacity: 100,
            kind: "SEATED",
          },
        ],
        sale_phases: [
          {
            starts_at: new Date(now - 60000).toISOString(),
            ends_at: new Date(now + 86400000).toISOString(),
            queue_enabled: false,
            admit_rate: 100,
            per_user_limit: 6,
            require_kyc: false,
          },
        ],
      },
      { version: 2, tenant_id: config.FAKE_ORGANIZER_ID },
    ),
  );
  // Ngoại lệ dev được giao: script phát dữ liệu giả, không phải handler nghiệp vụ.
  const kafka = new Kafka({
    clientId: "booking-fake-event",
    brokers: config.KAFKA_BROKERS.split(",").map((value) => value.trim()),
    logLevel: logLevel.NOTHING,
  });
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  try {
    await producer.connect();
    await producer.send({
      topic: topicOf.EventApproved,
      acks: -1,
      messages: [{ key: config.FAKE_EVENT_ID, value: JSON.stringify(message) }],
    });
    process.stdout.write(
      `${JSON.stringify({ message_id: message.message_id, event_id: config.FAKE_EVENT_ID, organizer_id: config.FAKE_ORGANIZER_ID, class_id: config.FAKE_CLASS_ID, version: 2 })}\n`,
    );
  } finally {
    await producer.disconnect();
  }
}
publishFakeEvent().catch(() => {
  process.stderr.write(
    "Fake event publish failed; check dev configuration and Kafka availability.\n",
  );
  process.exitCode = 1;
});
