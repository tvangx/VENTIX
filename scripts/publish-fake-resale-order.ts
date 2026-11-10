import { createRequire } from "node:module";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// Chạy từ payment workspace để dùng dependency có sẵn, không thêm thư viện root.
const paymentRequire = createRequire(join(process.cwd(), "package.json"));
const { Kafka, logLevel } = paymentRequire(
  "kafkajs",
) as typeof import("../services/payment/node_modules/kafkajs");
const { newMessage, ResaleOrderAwaitingPayment, topicOf } = paymentRequire(
  "@ticketing/event-contracts",
) as typeof import("../services/payment/node_modules/@ticketing/event-contracts");
const { z } = paymentRequire("zod") as typeof import("../services/payment/node_modules/zod");

async function publishFakeResaleOrder(): Promise<void> {
  const config = z
    .object({
      KAFKA_BROKERS: z.string().min(1).default("localhost:9092"),
      FAKE_RESALE_ORDER_ID: z.string().uuid().default(randomUUID()),
      FAKE_LISTING_ID: z.string().uuid().default(randomUUID()),
      FAKE_BUYER_ID: z.string().uuid().default(randomUUID()),
      FAKE_EVENT_ID: z.string().uuid().default(randomUUID()),
      FAKE_AMOUNT_VND: z.coerce
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .default(125000),
      FAKE_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().max(86400).default(900),
    })
    .parse(process.env);
  const message = ResaleOrderAwaitingPayment.parse(
    newMessage("ResaleOrderAwaitingPayment", {
      resale_order_id: config.FAKE_RESALE_ORDER_ID,
      listing_id: config.FAKE_LISTING_ID,
      buyer_id: config.FAKE_BUYER_ID,
      event_id: config.FAKE_EVENT_ID,
      amount_vnd: config.FAKE_AMOUNT_VND,
      expires_at: new Date(Date.now() + config.FAKE_EXPIRES_IN_SECONDS * 1000).toISOString(),
    }),
  );
  // Ngoại lệ dev được giao ở T-405: chỉ phát dữ liệu giả, không phải handler nghiệp vụ.
  const kafka = new Kafka({
    clientId: "payment-fake-resale-order",
    brokers: config.KAFKA_BROKERS.split(",").map((value) => value.trim()),
    logLevel: logLevel.NOTHING,
  });
  const producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  try {
    await producer.connect();
    await producer.send({
      topic: topicOf.ResaleOrderAwaitingPayment,
      acks: -1,
      messages: [{ key: config.FAKE_LISTING_ID, value: JSON.stringify(message) }],
    });
    process.stdout.write(
      `${JSON.stringify({ message_id: message.message_id, ...message.data })}\n`,
    );
  } finally {
    await producer.disconnect();
  }
}
publishFakeResaleOrder().catch(() => {
  process.stderr.write(
    "Fake resale order publish failed; check dev configuration and Kafka availability.\n",
  );
  process.exitCode = 1;
});
