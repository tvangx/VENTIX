#!/usr/bin/env node
// Chạy `prisma generate` chỉ khi schema đã có model. Prisma 5 báo lỗi nếu schema chưa có model,
// mà template ban đầu chưa có model nào. Dùng được cả trên Windows lẫn bash.
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const schema = join(__dirname, "..", "prisma", "schema.prisma");
const hasModel = /^\s*model\s+\w+\s*\{/m.test(readFileSync(schema, "utf8"));

if (!hasModel) {
  process.stdout.write("prisma generate: skipped (schema has no model yet)\n");
  process.exit(0);
}

const bin = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(bin, ["exec", "prisma", "generate"], {
  stdio: "inherit",
  cwd: join(__dirname, ".."),
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
