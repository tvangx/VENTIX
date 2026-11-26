import type { NextFunction, Request, Response } from "express";
import { Histogram, Registry } from "prom-client";

export type HttpMetricLabel = "service" | "method" | "route" | "status_class";
const methods = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "CONNECT",
  "TRACE",
]);

/** Đo khi response kết thúc để bao phủ lỗi guard/filter và 404, không đo lại trong interceptor. */
export class HttpMetrics {
  readonly duration: Histogram<HttpMetricLabel>;
  private readonly observed = new WeakSet<Response>();

  constructor(
    registry: Registry,
    private readonly service: string,
  ) {
    this.duration = new Histogram({
      name: "http_server_request_duration_seconds",
      help: "Completed HTTP server request duration in seconds (excluding metrics scrapes)",
      labelNames: ["service", "method", "route", "status_class"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    });
  }

  observe(req: Request, res: Response, next: NextFunction): void {
    // Nest middleware có thể được mount ở '/', làm req.path mất tiền tố trong callback.
    // originalUrl chỉ dùng để bỏ scrape, tuyệt đối không dùng làm label.
    const pathname = req.originalUrl.split("?", 1)[0];
    if (/^\/metrics\/?$/i.test(pathname) || this.observed.has(res)) {
      next();
      return;
    }
    this.observed.add(res);
    const start = process.hrtime.bigint();
    res.once("finish", () => {
      // Express route.path là mẫu đăng ký (đã gồm prefix Nest), baseUrl có thể chứa ID thực.
      const path: unknown = req.route?.path;
      const route =
        typeof path === "string" && path.startsWith("/") && !path.includes("*")
          ? path
          : "unmatched";
      this.duration.observe(
        {
          service: this.service,
          method: methods.has(req.method) ? req.method : "OTHER",
          route,
          status_class: `${Math.floor(res.statusCode / 100)}xx`,
        },
        Number(process.hrtime.bigint() - start) / 1e9,
      );
    });
    next();
  }
}
