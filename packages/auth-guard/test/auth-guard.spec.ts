import "reflect-metadata";
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { SignJWT, exportJWK, exportSPKI, generateKeyPair, KeyLike } from "jose";
import {
  AuthGuardOptions,
  IS_PUBLIC_KEY,
  JwtAuthGuard,
  JwtVerifier,
  ROLES_KEY,
  RolesGuard,
  assertSameOrganizer,
  authEnvShape,
  refineAuthEnv,
} from "../src";
import { z } from "zod";

const ISS = "https://identity.test";
const AUD = "ticketing-api";

async function makeKey(kid = "k1") {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  return { publicKey, privateKey, kid };
}

async function sign(
  key: KeyLike,
  claims: Record<string, unknown> = {},
  o: { kid?: string; iss?: string; aud?: string; exp?: string | number } = {},
) {
  return new SignJWT({ roles: ["USER"], ...claims })
    .setProtectedHeader({ alg: "RS256", kid: o.kid ?? "k1" })
    .setSubject("user-1")
    .setIssuer(o.iss ?? ISS)
    .setAudience(o.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "5m")
    .sign(key);
}

function ctx(headers: Record<string, string>, meta: Record<string, unknown> = {}, user?: unknown) {
  const req: Record<string, unknown> = { headers, user };
  const handler = () => undefined;
  class Cls {}
  Reflect.defineMetadata(IS_PUBLIC_KEY, meta[IS_PUBLIC_KEY], handler);
  Reflect.defineMetadata(ROLES_KEY, meta[ROLES_KEY], handler);
  const ec = {
    getHandler: () => handler,
    getClass: () => Cls,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ec, req };
}

describe("JwtAuthGuard (static public key)", () => {
  let k: Awaited<ReturnType<typeof makeKey>>;
  let guard: JwtAuthGuard;

  beforeAll(async () => {
    k = await makeKey();
    const options: AuthGuardOptions = {
      issuer: ISS,
      audience: AUD,
      publicKeyPem: await exportSPKI(k.publicKey),
    };
    guard = new JwtAuthGuard(new Reflector(), new JwtVerifier(options));
  });

  const expect401 = async (headers: Record<string, string>) => {
    await expect(guard.canActivate(ctx(headers).ec)).rejects.toMatchObject({ status: 401 });
  };

  it("accepts a valid token and sets req.user", async () => {
    const token = await sign(k.privateKey, { roles: ["USER", "ORGANIZER"], organizer_id: "org-1" });
    const { ec, req } = ctx({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ec)).resolves.toBe(true);
    expect(req.user).toEqual({
      userId: "user-1",
      roles: ["USER", "ORGANIZER"],
      organizerId: "org-1",
    });
  });

  it("401 when there is no token", async () => {
    await expect401({});
  });

  it("401 for non-bearer scheme", async () => {
    await expect401({ authorization: "Basic abc" });
  });

  it("401 for a token signed by another key", async () => {
    const other = await makeKey();
    await expect401({ authorization: `Bearer ${await sign(other.privateKey)}` });
  });

  it("401 for an expired token", async () => {
    const exp = Math.floor(Date.now() / 1000) - 600;
    await expect401({ authorization: `Bearer ${await sign(k.privateKey, {}, { exp })}` });
  });

  it("401 for wrong issuer", async () => {
    await expect401({
      authorization: `Bearer ${await sign(k.privateKey, {}, { iss: "https://evil" })}`,
    });
  });

  it("401 for wrong audience", async () => {
    await expect401({ authorization: `Bearer ${await sign(k.privateKey, {}, { aud: "other" })}` });
  });

  it("401 for a token without exp", async () => {
    const t = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256" })
      .setSubject("u")
      .setIssuer(ISS)
      .setAudience(AUD)
      .sign(k.privateKey);
    await expect401({ authorization: `Bearer ${t}` });
  });

  it("401 for alg != RS256 (HS256 signed with the public key as secret)", async () => {
    const secret = new TextEncoder().encode(await exportSPKI(k.publicKey));
    const t = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("u")
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(secret);
    await expect401({ authorization: `Bearer ${t}` });
  });

  it("401 for alg=none", async () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const t = `${b64({ alg: "none", typ: "JWT" })}.${b64({
      sub: "u",
      iss: ISS,
      aud: AUD,
      exp: Math.floor(Date.now() / 1000) + 300,
    })}.`;
    await expect401({ authorization: `Bearer ${t}` });
  });

  it("401 for a different RS-family alg (RS512)", async () => {
    const t = await new SignJWT({})
      .setProtectedHeader({ alg: "RS512" })
      .setSubject("u")
      .setIssuer(ISS)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(k.privateKey);
    await expect401({ authorization: `Bearer ${t}` });
  });

  it("skips auth for @Public()", async () => {
    await expect(guard.canActivate(ctx({}, { [IS_PUBLIC_KEY]: true }).ec)).resolves.toBe(true);
  });
});

describe("RolesGuard / tenant", () => {
  const rg = new RolesGuard(new Reflector());

  it("allows when no roles are required", () => {
    expect(rg.canActivate(ctx({}, {}, { userId: "u", roles: [] }).ec)).toBe(true);
  });

  it("allows when user has one of the roles", () => {
    expect(
      rg.canActivate(
        ctx({}, { [ROLES_KEY]: ["ADMIN", "STAFF"] }, { userId: "u", roles: ["STAFF"] }).ec,
      ),
    ).toBe(true);
  });

  it("403 when role is missing", () => {
    expect(() =>
      rg.canActivate(ctx({}, { [ROLES_KEY]: ["ADMIN"] }, { userId: "u", roles: ["USER"] }).ec),
    ).toThrow(expect.objectContaining({ status: 403 }));
  });

  it("assertSameOrganizer rejects other tenants", () => {
    expect(() => assertSameOrganizer({ userId: "u", roles: [], organizerId: "a" }, "b")).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => assertSameOrganizer({ userId: "u", roles: [] }, "b")).toThrow();
    expect(() =>
      assertSameOrganizer({ userId: "u", roles: [], organizerId: "b" }, "b"),
    ).not.toThrow();
  });
});

describe("JwtVerifier (JWKS)", () => {
  let server: Server;
  let url: string;
  let hits = 0;
  let keys: unknown[] = [];

  beforeAll(async () => {
    server = createServer((_req, res) => {
      hits++;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  async function jwk(k: Awaited<ReturnType<typeof makeKey>>) {
    return { ...(await exportJWK(k.publicKey)), kid: k.kid, alg: "RS256", use: "sig" };
  }

  it("refreshes on unknown kid when cooldown has passed", async () => {
    const a = await makeKey("a");
    const b = await makeKey("b");
    keys = [await jwk(a)];
    hits = 0;
    const v = new JwtVerifier({ issuer: ISS, audience: AUD, jwksUri: url, jwksCooldownMs: 0 });
    await expect(v.verify(await sign(a.privateKey, {}, { kid: "a" }))).resolves.toMatchObject({
      userId: "user-1",
    });
    await v.verify(await sign(a.privateKey, {}, { kid: "a" }));
    expect(hits).toBe(1); // cache hit

    keys = [await jwk(a), await jwk(b)]; // xoay khóa
    await expect(v.verify(await sign(b.privateKey, {}, { kid: "b" }))).resolves.toMatchObject({
      userId: "user-1",
    });
    expect(hits).toBe(2);
  });

  it("does NOT refetch within cooldown for unknown kid (401)", async () => {
    const a = await makeKey("a");
    const b = await makeKey("b");
    keys = [await jwk(a)];
    hits = 0;
    const v = new JwtVerifier({ issuer: ISS, audience: AUD, jwksUri: url, jwksCooldownMs: 60_000 });
    await v.verify(await sign(a.privateKey, {}, { kid: "a" }));
    keys = [await jwk(a), await jwk(b)];
    await expect(v.verify(await sign(b.privateKey, {}, { kid: "b" }))).rejects.toMatchObject({
      status: 401,
    });
    expect(hits).toBe(1);
  });
});

describe("authEnvShape", () => {
  const schema = z
    .object({ NODE_ENV: z.string(), ...authEnvShape })
    .superRefine((e, c) => refineAuthEnv(e, c));
  const base = { AUTH_ISSUER: ISS, AUTH_AUDIENCE: AUD };

  it("requires JWKS or PEM", () => {
    expect(schema.safeParse({ NODE_ENV: "development", ...base }).success).toBe(false);
  });
  it("forbids PEM in production", () => {
    expect(
      schema.safeParse({ NODE_ENV: "production", ...base, AUTH_PUBLIC_KEY_PEM: "x" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ NODE_ENV: "production", ...base, AUTH_JWKS_URI: "https://i/jwks" })
        .success,
    ).toBe(true);
  });
});
