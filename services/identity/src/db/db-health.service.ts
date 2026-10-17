import { Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { ENV } from "../app.tokens";
import type { Env } from "../config/env.schema";

/**
 * Kiểm tra DB cho /health/ready. Dùng `pg` trực tiếp vì Prisma 5 không generate được client
 * khi chưa có model; khi service có model đầu tiên, thêm PrismaService (docs/dev/new-service.md).
 */
@Injectable()
export class DbHealthService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 2000,
    });
    // Lỗi của client nhàn rỗi (DB restart) không được làm sập process.
    this.pool.on("error", () => undefined);
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

@Module({ providers: [DbHealthService], exports: [DbHealthService] })
export class DbModule {}
