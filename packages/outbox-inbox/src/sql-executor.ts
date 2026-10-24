/**
 * Giao diện tối thiểu để chạy SQL. Thư viện chỉ biết `SqlExecutor`, không phụ thuộc cứng vào Prisma hay pg.
 * Quy ước: mọi câu lệnh trong thư viện đều trả về dòng (SELECT hoặc `... RETURNING`) để cùng chạy được
 * trên `pg` lẫn Prisma `$queryRawUnsafe`.
 */
export interface SqlExecutor {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
}

/** Mở một transaction và đưa `SqlExecutor` gắn với transaction đó cho `fn`. Commit nếu `fn` xong, rollback nếu ném lỗi. */
export interface Database {
  transaction<R>(fn: (exec: SqlExecutor) => Promise<R>): Promise<R>;
}

/** Phần tối thiểu của `pg.Client` / `pg.PoolClient` mà adapter cần. */
export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

/** Phần tối thiểu của Prisma transaction client (`tx` trong `prisma.$transaction(async (tx) => ...)`). */
export interface PrismaRawQueryable {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/** Adapter cho `pg` (Client hoặc PoolClient đã `BEGIN`). */
export function fromPgClient(client: PgQueryable): SqlExecutor {
  return {
    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
      const res = await client.query(sql, params);
      return res.rows as T[];
    },
  };
}

/** Adapter cho Prisma: `tx` phải là transaction client để cùng transaction với nghiệp vụ. */
export function fromPrismaTx(tx: PrismaRawQueryable): SqlExecutor {
  return {
    async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
      const rows = await tx.$queryRawUnsafe<T[] | undefined>(sql, ...params);
      return rows ?? [];
    },
  };
}
