import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import { EventApprovedV2, EventCancelledV2, Topics } from "@ticketing/event-contracts";
import { Kafka, logLevel, type Consumer } from "kafkajs";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { EVENTS, VENUES, eventInput, organizerApp, venueInput } from "../helpers/organizer-app";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Test Kafka port unavailable"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

describe("S-203 event lifecycle on PostgreSQL and Kafka", () => {
  const adminEvents = "/v1/admin/events";
  let broker: StartedTestContainer;
  let consumer: Consumer;
  let app: Awaited<ReturnType<typeof organizerApp>>;
  let organizer: string;
  let admin: string;
  let outsider: string;
  let tenant: string;
  const received: { key: string; value: unknown }[] = [];

  beforeAll(async () => {
    const port = await freePort();
    broker = await new GenericContainer("apache/kafka:3.8.0")
      .withExposedPorts({ container: port, host: port })
      .withEnvironment({
        KAFKA_NODE_ID: "1",
        KAFKA_PROCESS_ROLES: "broker,controller",
        KAFKA_LISTENERS: "PLAINTEXT://:" + port + ",CONTROLLER://:9093",
        KAFKA_ADVERTISED_LISTENERS: "PLAINTEXT://127.0.0.1:" + port,
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
    const brokers = ["127.0.0.1:" + port];
    const kafka = new Kafka({
      clientId: "event-lifecycle-test",
      brokers,
      logLevel: logLevel.NOTHING,
    });
    const kafkaAdmin = kafka.admin();
    await kafkaAdmin.connect();
    try {
      await kafkaAdmin.createTopics({
        waitForLeaders: true,
        topics: [{ topic: Topics.EVENT_LIFECYCLE, numPartitions: 3 }],
      });
    } finally {
      await kafkaAdmin.disconnect();
    }

    consumer = kafka.consumer({ groupId: "event-lifecycle-" + randomUUID() });
    await consumer.connect();
    await consumer.subscribe({ topic: Topics.EVENT_LIFECYCLE, fromBeginning: true });
    await consumer.run({
      eachMessage: async ({ message }) => {
        if (message.key && message.value)
          received.push({
            key: message.key.toString(),
            value: JSON.parse(message.value.toString()),
          });
      },
    });

    app = await organizerApp({ kafkaBrokers: brokers });
    tenant = randomUUID();
    organizer = await app.token(tenant);
    outsider = await app.token(randomUUID());
    admin = await app.token(undefined, ["ADMIN"]);
  });

  afterAll(async () => {
    await app?.close();
    await consumer?.disconnect();
    await broker?.stop();
  });

  function post(url: string, dto: object, token = organizer, key = randomUUID()) {
    return app.http.post(url).auth(token, { type: "bearer" }).set("Idempotency-Key", key).send(dto);
  }

  async function fixture(seated = false, withMap = true) {
    const venue = await post(VENUES, venueInput).expect(201);
    const event = await post(EVENTS, eventInput(String(venue.body.id))).expect(201);
    const id = String(event.body.id);
    const url = EVENTS + "/" + id;
    const klass = await post(url + "/ticket-classes", {
      name: "Standard",
      price_vnd: 150000,
      capacity: 100,
      kind: seated ? "SEATED" : "GA",
    }).expect(201);
    await post(url + "/sale-phases", {
      starts_at: "2029-12-01T00:00:00Z",
      ends_at: "2030-01-01T18:00:00Z",
      admit_rate: 3,
      per_user_limit: 2,
    }).expect(201);
    if (seated && withMap) {
      await post(url + "/seat-maps", {
        layout: {
          zones: [
            {
              name: "Main",
              blocks: [
                { name: "A", rows: [{ label: "R", seats: 2, ticket_class_id: klass.body.id }] },
              ],
            },
          ],
        },
      }).expect(201);
    }
    return { id, url };
  }

  const decide = (id: string, body: object, token = admin, key = randomUUID()) =>
    post(adminEvents + "/" + id + "/decision", body, token, key);

  async function eventMessages(id: string) {
    const result = await app.db.pool.query<{ event_type: string; published_at: Date | null }>(
      "SELECT event_type,published_at FROM outbox_events WHERE message_key=$1 ORDER BY created_at,id",
      [id],
    );
    return result.rows;
  }

  async function waitForMessage(id: string, type: string): Promise<unknown> {
    const deadline = Date.now() + 15000;
    do {
      const item = received.find(
        (message) => message.key === id && (message.value as { type?: string })?.type === type,
      );
      if (
        item &&
        (await eventMessages(id)).some((row) => row.event_type === type && row.published_at)
      )
        return item.value;
      await setTimeout(50);
    } while (Date.now() < deadline);
    throw new Error("Kafka message or outbox acknowledgement missing: " + type);
  }

  it("audits rejection and resubmission, then publishes a seated snapshot only after Organizer publishes", async () => {
    const { id, url } = await fixture(true);
    await post(url + "/publish", { version: 0 }).expect(409);
    await post(url + "/submit", { version: 0 }, outsider).expect(404);
    await post(url + "/submit", { version: 0 }).expect(200);
    await app.http
      .get(adminEvents + "?limit=1")
      .auth(organizer, { type: "bearer" })
      .expect(403);
    await app.http
      .get(adminEvents + "?limit=1")
      .auth(admin, { type: "bearer" })
      .expect(200)
      .expect(({ body }) =>
        expect(body.items).toEqual([expect.objectContaining({ id, status: "PENDING" })]),
      );
    await app.http
      .get(adminEvents + "/" + id)
      .auth(admin, { type: "bearer" })
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({
          id,
          ticket_classes: [{ kind: "SEATED", price_vnd: 150000 }],
          sale_phases: [{ admit_rate: 3 }],
          seat_map: { version: 1, published_at: null },
        }),
      );
    await decide(id, { version: 1, decision: "REJECTED" }, organizer).expect(403);
    await decide(id, { version: 1, decision: "REJECTED" }).expect(400);
    const rejectKey = randomUUID();
    const rejection = { version: 1, decision: "REJECTED", reason: "Cần bổ sung thông tin" };
    await decide(id, rejection, admin, rejectKey).expect(200);
    await decide(id, rejection, admin, rejectKey).expect(200);
    await post(url + "/submit", { version: 2 }).expect(200);
    await decide(id, { version: 2, decision: "APPROVED" }).expect(409);
    await decide(id, { version: 3, decision: "APPROVED" }).expect(200);
    expect(await eventMessages(id)).toHaveLength(0);
    const before = await app.db.pool.query("SELECT published_at FROM seat_maps WHERE event_id=$1", [
      id,
    ]);
    expect(before.rows[0].published_at).toBeNull();
    const history = await app.db.pool.query(
      "SELECT decision,reason FROM event_approvals WHERE event_id=$1 ORDER BY created_at",
      [id],
    );
    expect(history.rows).toEqual([
      { decision: "REJECTED", reason: "Cần bổ sung thông tin" },
      { decision: "APPROVED", reason: null },
    ]);
    await post(url + "/publish", { version: 4 }, outsider).expect(404);
    const publishKey = randomUUID();
    await post(url + "/publish", { version: 4 }, organizer, publishKey)
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: "PUBLISHED", version: 5 }));
    await post(url + "/publish", { version: 4 }, organizer, publishKey).expect(200);
    const map = await app.db.pool.query("SELECT published_at FROM seat_maps WHERE event_id=$1", [
      id,
    ]);
    expect(map.rows[0].published_at).toBeInstanceOf(Date);
    const approved = EventApprovedV2.parse(await waitForMessage(id, "EventApproved"));
    expect(approved).toMatchObject({
      tenant_id: tenant,
      data: {
        event_id: id,
        event_version: 5,
        seat_map_version: 1,
        ticket_classes: [{ kind: "SEATED", price_vnd: 150000 }],
        sale_phases: [{ admit_rate: 3 }],
      },
    });
    expect(await eventMessages(id)).toHaveLength(1);
  });

  it("publishes GA-only with map version zero and relays cancellation with the next version", async () => {
    const { id, url } = await fixture();
    await post(url + "/submit", { version: 0 }).expect(200);
    await decide(id, { version: 1, decision: "APPROVED" }).expect(200);
    await post(url + "/publish", { version: 2 }).expect(200);
    const approved = EventApprovedV2.parse(await waitForMessage(id, "EventApproved"));
    expect(approved.data.seat_map_version).toBe(0);
    await post(EVENTS + "/" + id.toUpperCase() + "/cancel", { version: 3, reason: "Dời lịch" })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ status: "CANCELLED", version: 4 }));
    const cancelled = EventCancelledV2.parse(await waitForMessage(id, "EventCancelled"));
    expect(cancelled.data).toEqual({
      event_id: id,
      organizer_id: tenant,
      reason: "Dời lịch",
      event_version: 4,
    });
    await post(url + "/cancel", { version: 4, reason: "Lặp lại" }).expect(409);
  });

  it("publishes a standing-only seat map for display while keeping snapshot map version zero", async () => {
    const { id, url } = await fixture();
    const classes = await app.db.pool.query("SELECT id FROM ticket_classes WHERE event_id=$1", [
      id,
    ]);
    const gaId = String(classes.rows[0].id);
    const area = { name: "Khu đứng A – sát sân khấu", ticket_class_id: gaId };
    await post(url + "/seat-maps", { layout: { zones: [], ga_areas: [area] } }).expect(201);
    await post(url + "/submit", { version: 0 }).expect(200);
    await decide(id, { version: 1, decision: "APPROVED" }).expect(200);
    await app.http.get("/v1/events/" + id).expect(404);
    await post(url + "/publish", { version: 2 }).expect(200);
    const map = await app.db.pool.query("SELECT published_at FROM seat_maps WHERE event_id=$1", [
      id,
    ]);
    expect(map.rows[0].published_at).toBeInstanceOf(Date);
    const approved = EventApprovedV2.parse(await waitForMessage(id, "EventApproved"));
    expect(approved.data.seat_map_version).toBe(0);
    await app.http
      .get("/v1/events/" + id)
      .expect(200)
      .expect(({ body }) =>
        expect(body.seat_map).toMatchObject({ layout: { zones: [], ga_areas: [area] } }),
      );
  });

  it("rejects a seated publish without a matching map and keeps unpublished cancellation private", async () => {
    const { id, url } = await fixture(true, false);
    await post(url + "/submit", { version: 0 }).expect(200);
    await decide(id, { version: 1, decision: "APPROVED" }).expect(200);
    await post(url + "/publish", { version: 2 })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe("SEAT_MAP_REQUIRED"));
    await post(url + "/cancel", { version: 2, reason: "Dừng sự kiện nháp" }).expect(200);
    expect(await eventMessages(id)).toHaveLength(0);
  });

  it("rolls back publish and seat map sealing when the outbox write fails", async () => {
    const { id, url } = await fixture(true);
    await post(url + "/submit", { version: 0 }).expect(200);
    await decide(id, { version: 1, decision: "APPROVED" }).expect(200);
    await app.db.pool.query(
      "ALTER TABLE outbox_events ADD CONSTRAINT test_reject_publish CHECK (message_key <> '" +
        id +
        "')",
    );
    await post(url + "/publish", { version: 2 }).expect(500);
    const result = await app.db.pool.query(
      "SELECT e.status,e.version,m.published_at FROM events e JOIN seat_maps m ON m.event_id=e.id WHERE e.id=$1",
      [id],
    );
    expect(result.rows[0]).toEqual({ status: "APPROVED", version: 2, published_at: null });
    expect(await eventMessages(id)).toHaveLength(0);
  });

  it("emits one snapshot with 50 simultaneous publish requests using distinct keys", async () => {
    const { id, url } = await fixture();
    await post(url + "/submit", { version: 0 }).expect(200);
    await decide(id, { version: 1, decision: "APPROVED" }).expect(200);
    const responses = await Promise.all(
      Array.from({ length: 50 }, () => post(url + "/publish", { version: 2 })),
    );
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(49);
    expect(await eventMessages(id)).toHaveLength(1);
  });
});
