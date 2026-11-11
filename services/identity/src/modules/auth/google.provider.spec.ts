import { createLocalJWKSet, exportJWK, generateKeyPair, KeyLike, SignJWT } from "jose";
import { envSchema } from "../../config/env.schema";
import { GoogleProvider } from "./google.provider";

describe("S-103 Google ID token verification", () => {
  let provider: GoogleProvider;
  let privateKey: KeyLike;
  let getKey: ReturnType<typeof createLocalJWKSet>;
  beforeAll(async () => {
    const pair = await generateKeyPair("RS256");
    privateKey = pair.privateKey;
    getKey = createLocalJWKSet({
      keys: [{ ...(await exportJWK(pair.publicKey)), kid: "google-test", alg: "RS256" }],
    });
    provider = new GoogleProvider(
      envSchema.parse({
        DATABASE_URL: "postgresql://test@localhost/test",
        AUTH_ISSUER: "test",
        AUTH_AUDIENCE: "test",
        AUTH_JWKS_URI: "http://localhost/jwks",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "test-secret",
      }),
    );
  });
  const token = (
    claims: Record<string, unknown> = {},
    audience = "client-id",
    expiration = "5m",
    key = privateKey,
  ) =>
    new SignJWT({
      sub: "subject",
      email: "GOOGLE@example.test",
      email_verified: true,
      nonce: "nonce",
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "google-test" })
      .setIssuer("https://accounts.google.com")
      .setAudience(audience)
      .setExpirationTime(expiration)
      .sign(key);
  it("verifies signature, claims and normalizes email", async () => {
    expect(await provider.verifyIdToken(await token(), "nonce", getKey)).toMatchObject({
      sub: "subject",
      email: "google@example.test",
    });
  });
  it.each(["nonce", "audience", "expired", "email", "signature"])(
    "rejects %s mismatch",
    async (reason) => {
      const otherKey = (await generateKeyPair("RS256")).privateKey;
      const jwt = await token(
        reason === "email" ? { email_verified: false } : {},
        reason === "audience" ? "attacker" : "client-id",
        reason === "expired" ? "-1m" : "5m",
        reason === "signature" ? otherKey : privateKey,
      );
      await expect(
        provider.verifyIdToken(jwt, reason === "nonce" ? "wrong" : "nonce", getKey),
      ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_INVALID" });
    },
  );
  it("sends the PKCE verifier only to the token endpoint", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id_token: "jwt" }), { status: 200 }));
    const verifyMock = jest.spyOn(provider, "verifyIdToken").mockResolvedValue({
      sub: "sub",
      email: "g@example.test",
      email_verified: true,
      nonce: "nonce",
    });
    try {
      await provider.exchange("code", "verifier", "nonce");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/token",
        expect.objectContaining({ method: "POST", body: expect.any(URLSearchParams) }),
      );
      const body = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
      expect(body.get("code_verifier")).toBe("verifier");
    } finally {
      fetchMock.mockRestore();
      verifyMock.mockRestore();
    }
  });
});
