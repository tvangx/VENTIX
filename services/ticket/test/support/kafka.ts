import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { Kafka, logLevel } from "kafkajs";
import { GenericContainer, Wait } from "testcontainers";

export async function startKafka() {
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("No test port"));
        return;
      }
      server.close(() => resolve(address.port));
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
  return {
    kafka: new Kafka({
      clientId: `ticket-test-${randomUUID()}`,
      brokers,
      logLevel: logLevel.NOTHING,
    }),
    brokers,
    stop: () => container.stop(),
  };
}
