import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { Kafka, logLevel } from "kafkajs";
import { GenericContainer, Wait, StartedTestContainer } from "testcontainers";
const KAFKA_IMAGE = "apache/kafka:3.8.0"; // Image đã dùng ở compose và outbox-inbox tests.
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface TestKafka {
  kafka: Kafka;
  brokers: string[];
  stop(): Promise<void>;
}

/**
 * Kafka KRaft một node (image `apache/kafka`, đã dùng trong compose). Cổng host = cổng container để
 * advertised listener `127.0.0.1:<port>` đúng cho client ngoài container.
 */
export async function startKafka(): Promise<TestKafka> {
  const port = await freePort();
  const container: StartedTestContainer = await new GenericContainer(KAFKA_IMAGE)
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
    .withStartupTimeout(120_000)
    .start();

  const kafka = new Kafka({
    clientId: `outbox-inbox-test-${randomUUID()}`,
    brokers: [`127.0.0.1:${port}`],
    logLevel: logLevel.NOTHING,
    retry: { retries: 10 },
  });
  return {
    kafka,
    brokers: [`127.0.0.1:${port}`],
    async stop() {
      await container.stop();
    },
  };
}
