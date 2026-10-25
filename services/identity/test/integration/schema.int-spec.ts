import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { testDatabase } from "../helpers/database";

describe("S-101 identity schema on PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>;
  beforeAll(async () => {
    db = await testDatabase();
  });
  afterAll(async () => {
    await db?.close();
  });

  it("deploys every business table and the canonical outbox/inbox", async () => {
    const { rows } = await db.pool.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    );
    expect(rows.map((r) => r.tablename)).toEqual(
      expect.arrayContaining([
        "users",
        "oauth_accounts",
        "refresh_tokens",
        "roles",
        "user_roles",
        "kyc_profiles",
        "organizers",
        "organizer_documents",
        "outbox_events",
        "processed_events",
      ]),
    );
  });

  it("seeds exactly 4 roles and can run twice without duplicates", async () => {
    db.seed();
    db.seed();
    const { rows } = await db.pool.query("SELECT id, code FROM roles ORDER BY id");
    expect(rows).toEqual(
      ["USER", "ORGANIZER", "STAFF", "ADMIN"].map((code, i) => ({ id: i + 1, code })),
    );
  });

  it("rejects duplicate or non-normalized email and invalid user status", async () => {
    const sql = "INSERT INTO users(id,email,updated_at) VALUES($1,$2,now())";
    await db.pool.query(sql, [randomUUID(), "unique@example.test"]);
    await expect(db.pool.query(sql, [randomUUID(), "unique@example.test"])).rejects.toMatchObject({
      code: "23505",
    });
    await expect(db.pool.query(sql, [randomUUID(), "CAPS@example.test"])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(db.pool.query("UPDATE users SET status='UNKNOWN'")).rejects.toMatchObject({
      code: "23514",
    });
  });

  it("enforces OAuth provider identity uniqueness and same-service foreign keys", async () => {
    const user = randomUUID();
    await db.pool.query(
      "INSERT INTO users(id,email,updated_at) VALUES($1,'oauth@example.test',now())",
      [user],
    );
    const sql =
      "INSERT INTO oauth_accounts(id,user_id,provider,provider_uid) VALUES($1,$2,'google','subject')";
    await db.pool.query(sql, [randomUUID(), user]);
    await expect(db.pool.query(sql, [randomUUID(), user])).rejects.toMatchObject({ code: "23505" });
    await expect(
      db.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,1)", [randomUUID()]),
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects tenant roles without an organizer scope", async () => {
    const { rows } = await db.pool.query("SELECT id FROM users LIMIT 1");
    await expect(
      db.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,2)", [rows[0].id]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("can roll back the schema in a fresh isolated database and redeploy", async () => {
    const clean = await testDatabase();
    try {
      await clean.pool.query(
        readFileSync(join(__dirname, "../../prisma/rollback/identity-init.sql"), "utf8"),
      );
      await clean.pool.query(
        readFileSync(
          join(__dirname, "../../prisma/migrations/20261025035958_identity_init/migration.sql"),
          "utf8",
        ),
      );
      clean.seed();
      expect(
        (await clean.pool.query("SELECT count(*)::int AS count FROM roles")).rows[0].count,
      ).toBe(4);
    } finally {
      await clean.close();
    }
  });
});
