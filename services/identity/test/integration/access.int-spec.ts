import { randomUUID } from "node:crypto";
import request from "supertest";
import { PrismaService } from "../../src/db/prisma.service";
import { seedAdmin } from "../../src/modules/access/admin-seed";
import { testApp } from "../helpers/app";

describe("S-104 RBAC and tenant boundaries", () => {
  let context: Awaited<ReturnType<typeof testApp>>;
  let userId: string;
  let userToken: string;
  let tenantToken: string;
  const organizerA = randomUUID();
  const organizerB = randomUUID();
  beforeAll(async () => {
    context = await testApp();
    const http = context.app.getHttpServer();
    const body = { email: "tenant@example.test", password: "Tenant-password-for-testing!" };
    const registered = await request(http)
      .post("/v1/auth/register")
      .set("Idempotency-Key", randomUUID())
      .send(body)
      .expect(201);
    userId = registered.body.id;
    userToken = (await request(http).post("/v1/auth/login").send(body).expect(200)).body
      .access_token;
    const prisma = context.app.get(PrismaService);
    for (const id of [organizerA, organizerB])
      await prisma.organizer.create({
        data: {
          id,
          ownerUserId: userId,
          companyName: id,
          status: "APPROVED",
          approvedBy: userId,
          approvedAt: new Date(),
        },
      });
    await prisma.userRole.create({ data: { userId, roleId: 2, organizerId: organizerA } });
    tenantToken = (
      await request(http)
        .post(`/v1/auth/tenants/${organizerA}/token`)
        .set("Authorization", `Bearer ${userToken}`)
        .expect(200)
    ).body.access_token;
  });
  afterAll(async () => {
    await context?.close();
  });
  const get = (id: string, token: string) =>
    request(context.app.getHttpServer())
      .get(`/v1/organizers/${id}/context`)
      .set("Authorization", `Bearer ${token}`);
  it("global USER token cannot enter a tenant even with a valid JWT", async () => {
    await get(organizerA, userToken).expect(403);
  });
  it("selected tenant token works only for its own organizer", async () => {
    await get(organizerA, tenantToken).expect(200);
    await get(organizerB, tenantToken).expect(403);
    await request(context.app.getHttpServer())
      .post(`/v1/auth/tenants/${organizerB}/token`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(403);
  });
  it("me exposes memberships without credentials", async () => {
    const me = await request(context.app.getHttpServer())
      .get("/v1/auth/me")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(me.body.memberships).toEqual([{ organizer_id: organizerA, role: "ORGANIZER" }]);
    expect(me.body.password_hash).toBeUndefined();
  });
  it("rechecks membership after revocation instead of trusting stale role claims", async () => {
    await context.db.pool.query("DELETE FROM user_roles WHERE user_id=$1 AND role_id=2", [userId]);
    await get(organizerA, tenantToken).expect(403);
  });
  it("bootstrap Admin is repeatable, has ADMIN, and preserves the existing password", async () => {
    const prisma = context.app.get(PrismaService);
    const id = await seedAdmin(prisma, "admin@example.test", "Admin-password-original!");
    expect(await seedAdmin(prisma, "admin@example.test", "Admin-password-different!")).toBe(id);
    const login = await request(context.app.getHttpServer())
      .post("/v1/auth/login")
      .send({ email: "admin@example.test", password: "Admin-password-original!" })
      .expect(200);
    const me = await request(context.app.getHttpServer())
      .get("/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.access_token}`)
      .expect(200);
    expect(me.body.roles).toContain("ADMIN");
    expect(await prisma.user.count({ where: { email: "admin@example.test" } })).toBe(1);
  });
});
