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
  readonly paymentResults: Counter<"provider" | "code">;
  readonly refunds: Counter<"status">;
  readonly http: HttpMetrics;

  constructor() {
    collectDefaultMetrics({ register: this.registry });
    this.refunds = new Counter({
      name: "refunds_total",
      help: "Durably recorded refund attempt outcomes",
      labelNames: ["status"],
      registers: [this.registry],
    });
    this.paymentResults = new Counter({
      name: "payment_callback_total",
      help: "Payment callback outcomes",
      labelNames: ["provider", "code"],
      registers: [this.registry],
    });
    this.http = new HttpMetrics(this.registry, SERVICE_NAME);
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
