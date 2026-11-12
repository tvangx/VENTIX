import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { PrismaClient } from "../../generated/client";
import { ENV } from "../app.tokens";
import type { Env } from "../config/env.schema";

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(@Inject(ENV) env: Pick<Env, "DATABASE_URL">) {
    super({ datasources: { db: { url: env.DATABASE_URL } } });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
