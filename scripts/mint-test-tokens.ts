import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
} from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

function main(): void {
  const { values } = parseArgs({
    options: {
      count: { type: "string", default: "5000" },
      "out-dir": { type: "string" },
      "private-key": { type: "string" },
      issuer: { type: "string", default: "https://identity.ticketing.local" },
      audience: { type: "string", default: "ticketing-api" },
      ttl: { type: "string", default: "7200" },
    },
  });
  const count = Number(values.count);
  const ttl = Number(values.ttl);
  if (!Number.isInteger(count) || count < 1 || count > 10000)
    throw new Error("count must be 1..10000");
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400) throw new Error("ttl must be 60..86400");
  if (!values.issuer || !values.audience) throw new Error("issuer and audience are required");
  // Giữ token/khóa trong vùng secrets đã được gitignore; không ghi đè phiên chạy cũ.
  const secrets = resolve("secrets");
  const out = resolve(values["out-dir"] ?? `secrets/t205-${randomUUID()}`);
  const child = relative(secrets, out);
  if (!child || isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) {
    throw new Error("out-dir must be a new directory below secrets/");
  }
  const key = values["private-key"]
    ? createPrivateKey(readFileSync(values["private-key"]))
    : generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error("An RSA key of at least 2048 bits is required");
  }
  mkdirSync(secrets, { recursive: true, mode: 0o700 });
  mkdirSync(out, { mode: 0o700 });
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const issuedAt = Math.floor(Date.now() / 1000);
  const tokens = Array.from({ length: count }, () => {
    const sub = randomUUID();
    const payload = encode({
      sub,
      roles: ["USER"],
      iss: values.issuer,
      aud: values.audience,
      iat: issuedAt,
      exp: issuedAt + ttl,
    });
    const input = `${header}.${payload}`;
    return {
      sub,
      token: `${input}.${sign("RSA-SHA256", Buffer.from(input), key).toString("base64url")}`,
    };
  });
  writeFileSync(resolve(out, "private.pem"), key.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
    flag: "wx",
  });
  writeFileSync(
    resolve(out, "public.pem"),
    createPublicKey(key).export({ type: "spki", format: "pem" }),
    { mode: 0o600, flag: "wx" },
  );
  writeFileSync(resolve(out, "tokens.json"), JSON.stringify(tokens), { mode: 0o600, flag: "wx" });
  process.stdout.write(
    `${JSON.stringify({ count, directory: out, expires_at: new Date((issuedAt + ttl) * 1000).toISOString() })}\n`,
  );
}

try {
  main();
} catch {
  process.stderr.write(
    "Token mint failed: check arguments, RSA dev key and a new secrets/ output directory.\n",
  );
  process.exitCode = 1;
}
