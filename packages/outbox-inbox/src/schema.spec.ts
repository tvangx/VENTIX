import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(join(__dirname, "..", "sql", "outbox_inbox.sql"), "utf8");

/** Lấy tên cột của một bảng từ khối CREATE TABLE trong file SQL chuẩn. */
function columnsOf(table: string): string[] {
  const body = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(
    sql,
  )?.[1];
  if (!body) throw new Error(`Table ${table} not found in sql/outbox_inbox.sql`);
  return body
    .split("\n")
    .map((line) => /^\s{2}([a-z_]+)\s+[a-z]/.exec(line)?.[1])
    .filter((c): c is string => c !== undefined);
}

/**
 * Cột mà code thư viện dùng (INSERT/SELECT/UPDATE). Khớp thật với Postgres được kiểm ở test integration;
 * bài này là lưới an toàn nhanh, không cần Docker.
 */
describe("sql/outbox_inbox.sql khớp code", () => {
  it("outbox_events có đủ cột relay và OutboxService dùng", () => {
    expect(columnsOf("outbox_events")).toEqual(
      expect.arrayContaining([
        "id",
        "topic",
        "message_key",
        "event_type",
        "payload",
        "created_at",
        "published_at",
      ]),
    );
  });

  it("processed_events có khóa chính (message_id, consumer)", () => {
    expect(columnsOf("processed_events")).toEqual(
      expect.arrayContaining(["message_id", "consumer", "processed_at"]),
    );
    expect(sql).toMatch(/PRIMARY KEY \(message_id, consumer\)/);
  });

  it("có index một phần cho dòng chưa gửi (relay polling)", () => {
    expect(sql).toMatch(/ix_outbox_unpublished[\s\S]*WHERE published_at IS NULL/);
  });
});
