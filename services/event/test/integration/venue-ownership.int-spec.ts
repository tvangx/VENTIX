import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testDatabase } from "../helpers/database";

const migrations = join(__dirname, "../../prisma/migrations");
const legacySql = readFileSync(join(migrations, "20261025043053_event_init/migration.sql"), "utf8");
const ownershipSql = readFileSync(
  join(migrations, "20261110123016_event_organizer_crud/migration.sql"),
  "utf8",
);

describe("S-201 Venue ownership migration", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  let venueId: string;

  beforeEach(async () => {
    db = await testDatabase({ migrate: false });
    venueId = randomUUID();
    await db.pool.query(legacySql);
    await db.pool.query(
      "INSERT INTO venues(id,name,address,capacity,updated_at) VALUES($1,'Venue','Address',100,now())",
      [venueId],
    );
  });

  afterEach(async () => {
    await db?.close();
  });

  async function addEvent(organizerId: string) {
    await db.pool.query(
      "INSERT INTO events(id,organizer_id,venue_id,title,description,start_at,end_at,updated_at) VALUES($1,$2,$3,'Event','Test',now(),now()+interval '1 day',now())",
      [randomUUID(), organizerId, venueId],
    );
  }

  it("keeps legacy events and assigns a venue to their common organizer", async () => {
    const organizer = randomUUID();
    await addEvent(organizer);
    await addEvent(organizer);
    await db.pool.query(ownershipSql);
    const row = await db.pool.query("SELECT organizer_id FROM venues WHERE id=$1", [venueId]);
    expect(row.rows[0].organizer_id).toBe(organizer);
    const events = await db.pool.query(
      "SELECT count(*)::int AS count FROM events WHERE venue_id=$1",
      [venueId],
    );
    expect(events.rows[0].count).toBe(2);

    const rollback = readFileSync(
      join(__dirname, "../../prisma/rollback/event-organizer-crud.sql"),
      "utf8",
    );
    await db.pool.query(rollback);
    const rolledBackVenue = await db.pool.query("SELECT * FROM venues WHERE id=$1", [venueId]);
    expect(rolledBackVenue.rows[0]).not.toHaveProperty("organizer_id");
    await db.pool.query(ownershipSql);
    const restored = await db.pool.query("SELECT organizer_id FROM venues WHERE id=$1", [venueId]);
    expect(restored.rows[0].organizer_id).toBe(organizer);
  });

  it.each([0, 2])(
    "rolls back an ownership guess when the venue has %i organizers",
    async (organizerCount) => {
      for (let index = 0; index < organizerCount; index++) {
        await addEvent(randomUUID());
      }
      const client = await db.pool.connect();
      try {
        await expect(client.query(ownershipSql)).rejects.toThrow("Venue ownership is ambiguous");
        await client.query("ROLLBACK");
        const cols = await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_name='venues'",
        );
        expect(cols.rows.map(({ column_name }) => column_name)).not.toContain("organizer_id");
        const venue = await client.query("SELECT id FROM venues WHERE id=$1", [venueId]);
        expect(venue.rowCount).toBe(1);
      } finally {
        client.release();
      }
    },
  );
});
