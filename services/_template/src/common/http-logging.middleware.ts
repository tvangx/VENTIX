import { Inject, Injectable, NestMiddleware } from "@nestjs/common";
import type { Logger } from "@ticketing/common";
import type { NextFunction, Request, Response } from "express";
import { LOGGER } from "../app.tokens";

/** Một dòng log JSON cho mỗi request. Không log header/body (tránh rò token, PII). */
@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const path = req.originalUrl.split("?")[0];
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
      this.logger[level](
        { method: req.method, path, status: res.statusCode, duration_ms: Math.round(durationMs) },
        "request",
      );
    });
    next();
  }
}
