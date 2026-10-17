import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import { requestContext } from "./request-context";

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  request_id: string | null;
}

/** Lỗi nghiệp vụ có mã ổn định (UPPER_SNAKE), trả về dạng RFC 7807. */
export class ProblemException extends HttpException {
  constructor(
    public readonly code: string,
    status: number,
    public readonly detail: string,
    public readonly extensions: Record<string, unknown> = {},
  ) {
    super({ code, detail }, status);
  }
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

const DEFAULT_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "UNPROCESSABLE_ENTITY",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
};

@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  constructor(private readonly logger?: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const requestId = requestContext.get()?.requestId ?? req.id ?? null;

    let status = 500;
    let code = DEFAULT_CODES[500];
    let detail = "Internal server error";
    let extensions: Record<string, unknown> = {};

    if (exception instanceof ProblemException) {
      status = exception.getStatus();
      code = exception.code;
      detail = exception.detail;
      extensions = exception.extensions;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = DEFAULT_CODES[status] ?? `HTTP_${status}`;
      const body = exception.getResponse();
      if (typeof body === "string") {
        detail = body;
      } else if (body && typeof body === "object") {
        const b = body as { message?: string | string[] };
        detail = Array.isArray(b.message) ? b.message.join("; ") : (b.message ?? exception.message);
        if (status === 400 && Array.isArray(b.message)) code = "VALIDATION_FAILED";
      }
    } else {
      // Lỗi không lường trước: chỉ log phía server, không rò stack ra client.
      this.logger?.error({ err: exception }, "unhandled exception");
    }

    if (status >= 500 && !(exception instanceof ProblemException)) {
      detail = "Internal server error";
    }

    const body: ProblemBody = {
      type: `urn:ticketing:problem:${code.toLowerCase()}`,
      title: TITLES[status] ?? "Error",
      status,
      detail,
      code,
      request_id: requestId,
    };

    res
      .status(status)
      .type("application/problem+json")
      .json({ ...extensions, ...body });
  }
}
