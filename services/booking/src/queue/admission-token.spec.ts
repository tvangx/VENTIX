import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { AdmissionTokens } from "./admission-token";

describe("admission tokens", () => {
  const secret = "synthetic-admission-key-for-unit-tests";
  const tokens = new AdmissionTokens(secret);
  const user = randomUUID();
  const event = randomUUID();
  const issued = Math.floor(Date.now() / 1000);
  const grant = { jti: randomUUID(), iat: issued, exp: issued + 600 };

  it("signs HS256 claims and replays without extending expiry", async () => {
    const token = await tokens.sign(user, event, grant);
    expect(await tokens.verify(token, user, event)).toMatchObject({
      sub: user,
      evt: event,
      ...grant,
    });
    expect(await tokens.sign(user, event, grant)).toBe(token);
  });

  it("rejects expired, wrong-user, wrong-event and wrong-secret tokens", async () => {
    const token = await tokens.sign(user, event, grant);
    await expect(tokens.verify(token, randomUUID(), event)).rejects.toThrow();
    await expect(tokens.verify(token, user, randomUUID())).rejects.toThrow();
    await expect(
      new AdmissionTokens("another-synthetic-admission-key-32").verify(token, user, event),
    ).rejects.toThrow();
    const old = await tokens.sign(user, event, { ...grant, iat: issued - 601, exp: issued - 1 });
    await expect(tokens.verify(old, user, event)).rejects.toThrow();
  });

  it.each(["HS384", "HS512"])("rejects a token signed with %s", async (alg) => {
    const token = await new SignJWT({ evt: event, ...grant })
      .setProtectedHeader({ alg })
      .setIssuer("booking-admission")
      .setAudience("booking")
      .setSubject(user)
      .sign(Buffer.from(secret));
    await expect(tokens.verify(token, user, event)).rejects.toThrow();
  });

  it("rejects missing jti and an excessive lifetime", async () => {
    for (const payload of [
      { iat: issued, exp: issued + 600 },
      { ...grant, exp: issued + 3600 },
    ]) {
      const token = await new SignJWT({ evt: event, ...payload })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer("booking-admission")
        .setAudience("booking")
        .setSubject(user)
        .sign(Buffer.from(secret));
      await expect(tokens.verify(token, user, event)).rejects.toThrow();
    }
  });
});
