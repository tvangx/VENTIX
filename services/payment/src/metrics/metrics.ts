import { Controller, Get, Injectable, NestMiddleware, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "@ticketing/auth-guard";
import type { NextFunction, Request, Response } from "express";
import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly paymentResults: Counter<"provider" | "code">;
  readonly refunds: Counter<"status">;
  readonly httpDuration: Histogram<"method" | "route" | "status">;

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
    this.httpDuration = new Histogram({
      name: "http_request_duration_seconds",
      help: "HTTP request duration in seconds",
      labelNames: ["method", "route", "status"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });
  }
}

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const end = this.metrics.httpDuration.startTimer();
    res.on("finish", () => {
      // Dùng route mẫu (không phải URL thật) để tránh bùng nổ cardinality.
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : "unmatched";
      end({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
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
