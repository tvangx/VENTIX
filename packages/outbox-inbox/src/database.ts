import { fromPgClient, fromPrismaTx } from "./sql-executor";
import type { Database, PgQueryable, PrismaRawQueryable } from "./sql-executor";

/** Phần tối thiểu của `pg.Pool`. */
export interface PgPoolLike {
  connect(): Promise<PgQueryable & { release(err?: Error | boolean): void }>;
}

/** Phần tối thiểu của `PrismaClient`. */
export interface PrismaLike {
  $transaction<R>(
    fn: (tx: PrismaRawQueryable) => Promise<R>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<R>;
}

/** `Database` trên `pg.Pool`: BEGIN / COMMIT / ROLLBACK trên một kết nối riêng. */
export function pgDatabase(pool: PgPoolLike): Database {
  return {
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(fromPgClient(client));
        await client.query("COMMIT");
        client.release();
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
          client.release();
        } catch (rollbackErr) {
          // Kết nối hỏng: hủy hẳn để pool không tái sử dụng kết nối đang ở trạng thái lạ.
          client.release(rollbackErr instanceof Error ? rollbackErr : true);
        }
        throw err;
      }
    },
  };
}

/** `Database` trên Prisma (`$transaction` interactive). `timeoutMs` phải lớn hơn thời gian gửi Kafka của một batch. */
export function prismaDatabase(prisma: PrismaLike, timeoutMs = 30_000): Database {
  return {
    transaction: (fn) =>
      prisma.$transaction((tx) => fn(fromPrismaTx(tx)), { timeout: timeoutMs, maxWait: 5_000 }),
  };
}
