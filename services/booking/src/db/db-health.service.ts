import { Inject, Injectable, Module, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";
import { ENV } from "../app.tokens";
import type { Env } from "../config/env.schema";

/** Health chỉ cần SELECT 1; Prisma client cho repository nằm trong generated/prisma. */
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
