import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testDatabase } from "../helpers/database";

describe("S-107 Event schema on PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => {
    db = await testDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });
  async function fixture() {
    const venue = randomUUID(),
      event = randomUUID(),
      ticket = randomUUID(),
      map = randomUUID(),
      zone = randomUUID(),
      block = randomUUID(),
      seat = randomUUID(),
      organizer = randomUUID();
    await db.pool.query(
      "INSERT INTO venues(id,organizer_id,name,address,capacity,updated_at) VALUES($1,$2,'Venue','Test address',100,now())",
      [venue, organizer],
    );
    await db.pool.query(
      "INSERT INTO events(id,organizer_id,venue_id,title,description,start_at,end_at,updated_at) VALUES($1,$2,$3,'Event','Test',now()+interval '1 day',now()+interval '2 days',now())",
      [event, organizer, venue],
    );
    await db.pool.query(
      "INSERT INTO ticket_classes(id,event_id,name,price_vnd,capacity,kind,updated_at) VALUES($1,$2,'VIP',100000,100,'SEATED',now())",
      [ticket, event],
    );
    await db.pool.query(
      "INSERT INTO seat_maps(id,event_id,layout,updated_at) VALUES($1,$2,'{}',now())",
      [map, event],
    );
    await db.pool.query(
      "INSERT INTO zones(id,event_id,seat_map_id,name,updated_at) VALUES($1,$2,$3,'Zone',now())",
      [zone, event, map],
    );
    await db.pool.query(
      "INSERT INTO blocks(id,event_id,zone_id,name,updated_at) VALUES($1,$2,$3,'Block',now())",
      [block, event, zone],
    );
    await db.pool.query(
      "INSERT INTO seats(id,event_id,block_id,ticket_class_id,row_label,seat_no,updated_at) VALUES($1,$2,$3,$4,'A',1,now())",
      [seat, event, block, ticket],
    );
    return { venue, event, ticket, map, zone, block, seat };
  }
  it("deploys all nine business tables plus canonical Outbox/Inbox", async () => {
    const { rows } = await db.pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    );
    expect(rows.map((r) => r.tablename)).toEqual(
      expect.arrayContaining([
        "venues",
        "events",
        "ticket_classes",
        "sale_phases",
        "seat_maps",
        "zones",
        "blocks",
        "seats",
        "event_approvals",
        "outbox_events",
        "processed_events",
      ]),
    );
  });
  it("rejects invalid time ranges, capacities, price and unknown states", async () => {
    const f = await fixture();
    for (const [sql, params] of [
      ["UPDATE events SET end_at=start_at WHERE id=$1", [f.event]],
      ["UPDATE venues SET capacity=0 WHERE id=$1", [f.venue]],
      ["UPDATE ticket_classes SET price_vnd=-1 WHERE id=$1", [f.ticket]],
      ["UPDATE events SET status='UNKNOWN' WHERE id=$1", [f.event]],
    ] as const)
      await expect(db.pool.query(sql, [...params])).rejects.toMatchObject({ code: "23514" });
  });
  it("keeps seat-map versions and seat coordinates unique", async () => {
    const f = await fixture();
    await expect(
      db.pool.query(
        "INSERT INTO seat_maps(id,event_id,layout,updated_at) VALUES($1,$2,'{}',now())",
        [randomUUID(), f.event],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.pool.query(
        "INSERT INTO seats(id,event_id,block_id,ticket_class_id,row_label,seat_no,updated_at) VALUES($1,$2,$3,$4,'A',1,now())",
        [randomUUID(), f.event, f.block, f.ticket],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
  it("prevents a seat from referencing a ticket class of a different event", async () => {
    const a = await fixture(),
      b = await fixture();
    await expect(
      db.pool.query("UPDATE seats SET ticket_class_id=$1 WHERE id=$2", [b.ticket, a.seat]),
    ).rejects.toMatchObject({ code: "23503" });
  });
  it("makes published maps and every level of their hierarchy immutable", async () => {
    const f = await fixture();
    await db.pool.query("UPDATE seat_maps SET published_at=now() WHERE id=$1", [f.map]);
    for (const [sql, id] of [
      ["UPDATE seat_maps SET layout='{}' WHERE id=$1", f.map],
      ["UPDATE zones SET name='changed' WHERE id=$1", f.zone],
      ["UPDATE blocks SET name='changed' WHERE id=$1", f.block],
      ["UPDATE seats SET seat_no=2 WHERE id=$1", f.seat],
      ["DELETE FROM seats WHERE id=$1", f.seat],
    ])
      await expect(db.pool.query(sql, [id])).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.pool.query(
        "INSERT INTO seats(id,event_id,block_id,ticket_class_id,row_label,seat_no,updated_at) VALUES($1,$2,$3,$4,'A',2,now())",
        [randomUUID(), f.event, f.block, f.ticket],
      ),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("blocks a concurrent seat edit until publication commits, then rejects it", async () => {
    const f = await fixture();
    const publisher = await db.pool.connect();
    try {
      await publisher.query("BEGIN");
      await publisher.query("UPDATE seat_maps SET published_at=now() WHERE id=$1", [f.map]);
      const edit = db.pool.query("UPDATE seats SET seat_no=2 WHERE id=$1", [f.seat]);
      // Gắn rejection handler trước COMMIT để không tạo unhandled rejection.
      const checked = expect(edit).rejects.toMatchObject({ code: "23514" });
      await publisher.query("COMMIT");
      await checked;
    } finally {
      await publisher.query("ROLLBACK");
      publisher.release();
    }
  });
  it("rolls back an empty DB and reapplies the schema", async () => {
    const clean = await testDatabase();
    try {
      await clean.pool.query(
        readFileSync(join(__dirname, "../../prisma/rollback/event-init.sql"), "utf8"),
      );
      await clean.pool.query(
        readFileSync(
          join(__dirname, "../../prisma/migrations/20261025043053_event_init/migration.sql"),
          "utf8",
        ),
      );
      expect(
        (await clean.pool.query("SELECT count(*)::int AS count FROM venues")).rows[0].count,
      ).toBe(0);
    } finally {
      await clean.close();
    }
  });
});
