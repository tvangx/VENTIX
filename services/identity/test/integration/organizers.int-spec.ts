import { randomUUID } from "node:crypto";
import { ProblemException } from "@ticketing/common";
import request from "supertest";
import { PrismaService } from "../../src/db/prisma.service";
import { seedAdmin } from "../../src/modules/access/admin-seed";
import { DocumentsStorage } from "../../src/modules/organizers/documents.storage";
import { testApp } from "../helpers/app";

describe("S-105 organizer application API + PostgreSQL", () => {
  let context: Awaited<ReturnType<typeof testApp>>;
  let adminToken: string;
  let put: jest.SpyInstance;
  let download: jest.SpyInstance;
  const pdf = Buffer.from("%PDF-1.7\nlicense-test\n%%EOF");
  beforeAll(async () => {
    context = await testApp();
    await seedAdmin(
      context.app.get(PrismaService),
      "reviewer@example.test",
      "Reviewer-password-testing!",
    );
    adminToken = (
      await request(context.app.getHttpServer())
        .post("/v1/auth/login")
        .send({ email: "reviewer@example.test", password: "Reviewer-password-testing!" })
        .expect(200)
    ).body.access_token;
    put = jest.spyOn(context.app.get(DocumentsStorage), "put");
    download = jest.spyOn(context.app.get(DocumentsStorage), "download");
  });
  beforeEach(() => {
    put.mockReset().mockResolvedValue(undefined);
    download.mockReset().mockResolvedValue("https://storage.test/private-signed-url");
  });
  afterAll(async () => {
    put?.mockRestore();
    download?.mockRestore();
    await context?.close();
  });
  const http = () => context.app.getHttpServer();
  async function owner() {
    const credentials = {
      email: `${randomUUID()}@example.test`,
      password: "Applicant-password-testing!",
    };
    const user = await request(http())
      .post("/v1/auth/register")
      .set("Idempotency-Key", randomUUID())
      .send(credentials)
      .expect(201);
    const login = await request(http()).post("/v1/auth/login").send(credentials).expect(200);
    return { id: user.body.id as string, token: login.body.access_token as string };
  }
  const apply = (token: string, key: string = randomUUID()) =>
    request(http())
      .post("/v1/organizer-applications")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send({ company_name: "VENTIX Test Organizer" });
  const upload = (id: string, token: string, key: string = randomUUID(), buffer = pdf) =>
    request(http())
      .post(`/v1/organizer-applications/${id}/documents`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .field("doc_type", "BUSINESS_LICENSE")
      .attach("file", buffer, { filename: "license.pdf", contentType: "application/pdf" });
  const decide = (id: string, decision = "APPROVED", version = 0, token = adminToken) =>
    request(http())
      .patch(`/v1/admin/organizer-applications/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision, version });

  it("creates PENDING idempotently and does not grant an Organizer role", async () => {
    const user = await owner();
    const key = randomUUID();
    const first = await apply(user.token, key).expect(201);
    const repeat = await apply(user.token, key).expect(201);
    expect(repeat.body).toEqual(first.body);
    expect(first.body.status).toBe("PENDING");
    expect(
      (
        await context.db.pool.query(
          "SELECT count(*)::int AS count FROM user_roles WHERE user_id=$1 AND role_id=2",
          [user.id],
        )
      ).rows[0].count,
    ).toBe(0);
  });
  it("blocks another user's metadata, uploads and admin access", async () => {
    const a = await owner();
    const b = await owner();
    const app = await apply(a.token).expect(201);
    await request(http())
      .get(`/v1/organizer-applications/${app.body.id}`)
      .set("Authorization", `Bearer ${b.token}`)
      .expect(403);
    await upload(app.body.id, b.token).expect(403);
    await decide(app.body.id, "APPROVED", 0, b.token).expect(403);
    expect(put).not.toHaveBeenCalled();
  });
  it("rejects missing license on approval and forged content on upload", async () => {
    const user = await owner();
    const app = await apply(user.token).expect(201);
    await decide(app.body.id).expect(422);
    await upload(app.body.id, user.token, randomUUID(), Buffer.from("not a pdf")).expect(400);
    expect(put).not.toHaveBeenCalled();
  });
  it("retries a failed storage upload without creating phantom metadata and replays successful uploads", async () => {
    const user = await owner();
    const app = await apply(user.token).expect(201);
    const key = randomUUID();
    put.mockRejectedValueOnce(
      new ProblemException("STORAGE_UNAVAILABLE", 503, "storage unavailable"),
    );
    await upload(app.body.id, user.token, key).expect(503);
    expect(
      (
        await context.db.pool.query(
          "SELECT count(*)::int AS count FROM organizer_documents WHERE organizer_id=$1",
          [app.body.id],
        )
      ).rows[0].count,
    ).toBe(0);
    const doc = await upload(app.body.id, user.token, key).expect(201);
    const repeat = await upload(app.body.id, user.token, key).expect(201);
    expect(repeat.body).toEqual(doc.body);
    expect(put).toHaveBeenCalledTimes(2);
    await upload(app.body.id, user.token, key, Buffer.from("%PDF-other")).expect(409);
  });
  it("two conflicting reviews have one winner, grant one scope, then block further uploads", async () => {
    const user = await owner();
    const app = await apply(user.token).expect(201);
    await upload(app.body.id, user.token).expect(201);
    const results = await Promise.all([decide(app.body.id), decide(app.body.id)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      (
        await context.db.pool.query(
          "SELECT organizer_id FROM user_roles WHERE user_id=$1 AND role_id=2",
          [user.id],
        )
      ).rows,
    ).toEqual([{ organizer_id: app.body.id }]);
    await upload(app.body.id, user.token).expect(409);
    await request(http())
      .post(`/v1/auth/tenants/${app.body.id}/token`)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(200);
  });
  it("rejection does not grant a role and private downloads require owner or Admin", async () => {
    const user = await owner();
    const other = await owner();
    const app = await apply(user.token).expect(201);
    const doc = await upload(app.body.id, user.token).expect(201);
    const path = `/v1/organizer-applications/${app.body.id}/documents/${doc.body.id}/download`;
    await request(http()).get(path).set("Authorization", `Bearer ${other.token}`).expect(403);
    const allowed = await request(http())
      .get(path)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(200);
    expect(allowed.headers["cache-control"]).toBe("no-store");
    await decide(app.body.id, "REJECTED").expect(200);
    await request(http())
      .post(`/v1/auth/tenants/${app.body.id}/token`)
      .set("Authorization", `Bearer ${user.token}`)
      .expect(403);
  });
  it("admin listing uses a bounded cursor with no duplicate entries", async () => {
    const user = await owner();
    await apply(user.token).expect(201);
    await apply(user.token).expect(201);
    const first = await request(http())
      .get("/v1/admin/organizer-applications")
      .query({ limit: 1 })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const next = await request(http())
      .get("/v1/admin/organizer-applications")
      .query({ limit: 1, cursor: first.body.next_cursor })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(first.body.data[0].id).not.toBe(next.body.data[0].id);
    await request(http())
      .get("/v1/admin/organizer-applications")
      .query({ limit: 101 })
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(400);
  });
});
