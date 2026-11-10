import { Controller, Get, Injectable, NestMiddleware, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "@ticketing/auth-guard";
import type { NextFunction, Request, Response } from "express";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly orderExpired = new Counter({
    name: "booking_orders_expired_total",
    help: "Orders expired by this replica",
    registers: [this.registry],
  });
  readonly orderSagaWork = new Counter({
    name: "booking_order_saga_work_total",
    help: "Durable order saga work outcomes",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });
  readonly seatPricingJobs = new Counter({
    name: "seat_pricing_jobs_total",
    help: "Seat pricing prefetch outcomes",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });
  readonly seatStreams = new Gauge({
    name: "seat_stream_connections",
    help: "Active seat SSE connections",
    registers: [this.registry],
  });
  readonly seatDeltaBatches = new Counter({
    name: "seat_delta_batches_total",
    help: "Seat delta batches delivered",
    registers: [this.registry],
  });
  readonly seatExpired = new Counter({
    name: "seat_expired_holds_total",
    help: "Expired holds announced by this replica",
    registers: [this.registry],
  });
  readonly seatStatusFailures = new Counter({
    name: "seat_status_failures_total",
    help: "Seat status failures",
    labelNames: ["operation"] as const,
    registers: [this.registry],
  });
  readonly httpDuration: Histogram<"method" | "route" | "status">;
  readonly seatHoldOutcomes = new Counter({
    name: "seat_hold_requests_total",
    help: "Atomic hold attempts by outcome",
    labelNames: ["outcome"] as const,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
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
