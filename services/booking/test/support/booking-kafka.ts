import { createServer } from "node:net";
import { Kafka, logLevel } from "kafkajs";
import { GenericContainer, Wait } from "testcontainers";

/** Cùng image với compose/T-103; listener host cần cổng cố định cho advertised.listeners. */
export async function startBookingKafka() {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const selected = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(selected));
    });
  });
  const container = await new GenericContainer("apache/kafka:3.8.0")
    .withExposedPorts({ container: port, host: port })
    .withEnvironment({
      KAFKA_NODE_ID: "1",
      KAFKA_PROCESS_ROLES: "broker,controller",
      KAFKA_LISTENERS: `PLAINTEXT://:${port},CONTROLLER://:9093`,
      KAFKA_ADVERTISED_LISTENERS: `PLAINTEXT://127.0.0.1:${port}`,
      KAFKA_CONTROLLER_LISTENER_NAMES: "CONTROLLER",
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
      KAFKA_CONTROLLER_QUORUM_VOTERS: "1@localhost:9093",
      KAFKA_INTER_BROKER_LISTENER_NAME: "PLAINTEXT",
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: "1",
      KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR: "1",
      KAFKA_TRANSACTION_STATE_LOG_MIN_ISR: "1",
      KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS: "0",
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "false",
    })
    .withWaitStrategy(Wait.forLogMessage(/Kafka Server started/))
    .withStartupTimeout(120000)
    .start();
  const brokers = [`127.0.0.1:${port}`];
  const kafka = new Kafka({
    clientId: "booking-lifecycle-test",
    brokers,
    logLevel: logLevel.NOTHING,
  });
  try {
    const admin = kafka.admin();
    await admin.connect();
    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: [
          { topic: "event.lifecycle", numPartitions: 3 },
          { topic: "event.lifecycle.dlq", numPartitions: 3 },
          { topic: "merch.stock", numPartitions: 3 },
          { topic: "merch.stock.dlq", numPartitions: 3 },
          { topic: "booking.orders", numPartitions: 3 },
        ],
      });
    } finally {
      await admin.disconnect();
    }
  } catch (error) {
    await container.stop();
    throw error;
  }
  return { kafka, brokers, close: () => container.stop() };
}
export type BookingKafka = Awaited<ReturnType<typeof startBookingKafka>>;
