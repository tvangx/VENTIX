import { Controller, Get, Injectable, NestMiddleware, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { HttpMetrics } from "@ticketing/common";
import { SERVICE_NAME } from "../service.constants";
import { Public } from "@ticketing/auth-guard";
import type { NextFunction, Request, Response } from "express";
import { Counter, Registry, collectDefaultMetrics } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly http: HttpMetrics;
  readonly catalogCache: Counter<"result">;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.http = new HttpMetrics(this.registry, SERVICE_NAME);
    this.catalogCache = new Counter({
      name: "event_catalog_cache_requests_total",
      help: "Catalog Redis cache outcomes",
      labelNames: ["result"],
      registers: [this.registry],
    });
  }
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    this.metrics.http.observe(req, res, next);
  }
}

/** Chỉ để Prometheus scrape trong mạng nội bộ; KHÔNG route qua Kong. */
@ApiExcludeController()
@Public()
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async scrape(@Res({ passthrough: true }) res: Response): Promise<string> {
    res.setHeader("Content-Type", this.metrics.registry.contentType);
    return this.metrics.registry.metrics();
  }
}
