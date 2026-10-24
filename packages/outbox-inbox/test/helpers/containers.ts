import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Kafka, logLevel } from "kafkajs";
import { Pool } from "pg";
import { GenericContainer, Wait } from "testcontainers";
import type { StartedTestContainer } from "testcontainers";

process.env.KAFKAJS_NO_PARTITIONER_WARNING = "1";

const KAFKA_IMAGE = process.env.KAFKA_TEST_IMAGE ?? "apache/kafka:3.8.0";
const POSTGRES_IMAGE = process.env.POSTGRES_TEST_IMAGE ?? "postgres:16";

export interface TestPostgres {
  pool: Pool;
  stop(): Promise<void>;
}

/** Postgres thật + schema chuẩn `sql/outbox_inbox.sql` + 2 bảng nghiệp vụ giả cho test. */
export async function startPostgres(): Promise<TestPostgres> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    POSTGRES_IMAGE,
  ).start();
  const pool = new Pool({ connectionString: container.getConnectionUri(), max: 20 });
  const schema = readFileSync(join(__dirname, "..", "..", "sql", "outbox_inbox.sql"), "utf8");
  await pool.query(schema);
  await pool.query(`
    CREATE TABLE orders_test (id uuid PRIMARY KEY, status text NOT NULL);
    CREATE TABLE effects_test (message_id uuid NOT NULL, consumer text NOT NULL);
  `);
  return {
    pool,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}

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
    async stop() {
      await container.stop();
    },
  };
}

export async function createTopics(
  kafka: Kafka,
  topics: Array<{ topic: string; numPartitions: number }>,
): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({ topics, waitForLeaders: true });
  } finally {
    await admin.disconnect();
  }
}
