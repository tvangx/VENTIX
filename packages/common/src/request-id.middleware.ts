import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { requestContext } from "./request-context";

export const REQUEST_ID_HEADER = "x-request-id";

// Chỉ chấp nhận ID "sạch" từ client để tránh log injection / header quá dài.
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;
const TRACEPARENT = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const requestId = candidate && SAFE_ID.test(candidate) ? candidate : randomUUID();

    const tp = req.headers["traceparent"];
    const traceId = typeof tp === "string" ? TRACEPARENT.exec(tp)?.[1] : undefined;

    (req as Request & { id: string }).id = requestId;
    res.setHeader("X-Request-Id", requestId);
    requestContext.run({ requestId, traceId }, () => next());
  }
}
