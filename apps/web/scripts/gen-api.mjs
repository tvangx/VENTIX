// Sinh kiểu TypeScript từ OpenAPI của các service (chỉ ĐỌC services/*/openapi.json).
// Dùng: node scripts/gen-api.mjs          → ghi src/lib/api/generated/<service>.d.ts
//       node scripts/gen-api.mjs --check  → không ghi, thoát mã 1 nếu file đã commit lệch OpenAPI.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString, COMMENT_HEADER } from "openapi-typescript";

// Chỉ service đã có OpenAPI thật; event/merch/ticket/resale thêm khi chủ service bàn giao OpenAPI.
const SERVICES = ["identity", "booking", "payment", "finance"];

const repoRoot = new URL("../../../", import.meta.url);
const outDir = new URL("../src/lib/api/generated/", import.meta.url);

async function generate(service) {
  const spec = readFileSync(new URL(`services/${service}/openapi.json`, repoRoot), "utf8");
  const ast = await openapiTS(JSON.parse(spec));
  return `${COMMENT_HEADER}${astToString(ast)}`;
}

async function main() {
  const check = process.argv.includes("--check");
  const stale = [];
  mkdirSync(outDir, { recursive: true });
  for (const service of SERVICES) {
    const target = new URL(`${service}.d.ts`, outDir);
    const next = await generate(service);
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current === next) continue;
    if (check) {
      stale.push(service);
    } else {
      writeFileSync(target, next);
      process.stdout.write(`generated ${fileURLToPath(target)}\n`);
    }
  }
  if (stale.length > 0) {
    process.stderr.write(
      `OpenAPI types out of date: ${stale.join(", ")}. Run: pnpm --filter @ticketing/web gen:api\n`,
    );
    process.exit(1);
  }
}

await main();
