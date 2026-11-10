import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "../../generated/client";
import { ENV } from "../app.tokens";
import type { Env } from "../config/env.schema";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({ datasources: { db: { url: env.DATABASE_URL } } });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
