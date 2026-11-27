import { parseStoredTraceContext } from "./trace-context";

describe("outbox trace context", () => {
  const traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";

  it("keeps only a valid W3C carrier", () => {
    expect(parseStoredTraceContext({ traceparent, tracestate: "vendor=value" })).toEqual({
      traceparent,
      tracestate: "vendor=value",
    });
  });

  it("treats missing, malformed, legacy and unsafe values as no context", () => {
    const invalid = [
      undefined,
      null,
      {},
      { traceparent: "not-a-trace" },
      { traceparent, tracestate: "line1\nline2" },
    ];
    for (const value of invalid) {
      const parsed = parseStoredTraceContext(value);
      expect(parsed).toBeUndefined();
    }
    expect(parseStoredTraceContext({ traceparent, baggage: "must-not-persist" })).toEqual({
      traceparent,
    });
  });
});
