import {
  context,
  isSpanContextValid,
  propagation,
  trace,
  type Context,
  type TextMapGetter,
} from "@opentelemetry/api";

export interface StoredTraceContext {
  traceparent: string;
  tracestate?: string;
}

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;
const getter: TextMapGetter<StoredTraceContext> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) =>
    key === "traceparent"
      ? carrier.traceparent
      : key === "tracestate"
        ? carrier.tracestate
        : undefined,
};

/** Capture only W3C propagation fields, never baggage or arbitrary request headers. */
export function captureTraceContext(
  active: Context = context.active(),
): StoredTraceContext | undefined {
  const spanContext = trace.getSpanContext(active);
  if (!spanContext || !isSpanContextValid(spanContext)) return undefined;
  const carrier: Record<string, string> = {};
  propagation.inject(active, carrier);
  return parseStoredTraceContext(carrier);
}

/** Reject malformed/legacy data so telemetry can never block an event. */
export function parseStoredTraceContext(value: unknown): StoredTraceContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.traceparent !== "string" || !TRACEPARENT.test(candidate.traceparent)) {
    return undefined;
  }
  if (
    candidate.tracestate !== undefined &&
    (typeof candidate.tracestate !== "string" ||
      candidate.tracestate.length > 512 ||
      /[\r\n]/.test(candidate.tracestate))
  ) {
    return undefined;
  }
  return candidate.tracestate === undefined
    ? { traceparent: candidate.traceparent }
    : { traceparent: candidate.traceparent, tracestate: candidate.tracestate };
}

export function extractTraceContext(stored: StoredTraceContext | undefined): Context {
  if (!stored) return context.active();
  return propagation.extract(context.active(), stored, getter);
}
