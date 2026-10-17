import pino, { Logger, LoggerOptions } from "pino";
import { requestContext } from "./request-context";

export type { Logger } from "pino";

/**
 * Logger JSON chuẩn: luôn có `service`, `request_id`, `trace_id`.
 * Che header nhạy cảm để không rò token vào log.
 */
export function createLogger(
  service: string,
  options: { level?: string; destination?: pino.DestinationStream } = {},
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
      return { request_id: ctx?.requestId ?? null, trace_id: ctx?.traceId ?? null };
    },
  };
  return options.destination ? pino(config, options.destination) : pino(config);
}
