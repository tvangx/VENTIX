import pino, { Logger, LoggerOptions } from "pino";
import { context, trace } from "@opentelemetry/api";
import { requestContext } from "./request-context";
import { RotatingLogDestination } from "./rotating-log-destination";

export type { Logger } from "pino";

/**
 * Logger JSON chuẩn: luôn có `service`, `request_id`, `trace_id`.
 * Che header nhạy cảm để không rò token vào log.
 */
export function createLogger(
  service: string,
  options: {
    level?: string;
    destination?: pino.DestinationStream;
    file?: { path: string; maxBytes: number; maxFiles: number };
  } = {},
): Logger {
  const config: LoggerOptions = {
    level: options.level ?? "info",
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["x-admission-token"]',
        "*.password",
        "*.token",
      ],
      censor: "[REDACTED]",
    },
    mixin() {
      const ctx = requestContext.get();
      const spanContext = trace.getSpanContext(context.active());
      // Prefer the active OTel span; the request header is retained only before telemetry is enabled.
      return {
        request_id: ctx?.requestId ?? null,
        trace_id: spanContext?.traceId ?? ctx?.traceId ?? null,
        span_id: spanContext?.spanId ?? null,
      };
    },
  };
  if (options.destination) return pino(config, options.destination);
  if (options.file) {
    return pino(
      config,
      pino.multistream([
        { stream: pino.destination(1) },
        {
          stream: new RotatingLogDestination(
            options.file.path,
            options.file.maxBytes,
            options.file.maxFiles,
          ),
        },
      ]),
    );
  }
  return pino(config);
}
