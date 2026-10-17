import type { Env } from "./config/env.schema";

/**
 * Chỉ bật OpenTelemetry khi có OTEL_EXPORTER_OTLP_ENDPOINT. Phải gọi TRƯỚC khi nạp
 * express/http để instrumentation vá được module (xem main.ts).
 */
export async function startTelemetry(
  env: Pick<Env, "OTEL_EXPORTER_OTLP_ENDPOINT">,
  serviceName: string,
): Promise<void> {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  const [{ NodeSDK }, { OTLPTraceExporter }, { HttpInstrumentation }, { ExpressInstrumentation }] =
    await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
      import("@opentelemetry/instrumentation-http"),
      import("@opentelemetry/instrumentation-express"),
    ]);

  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, "")}/v1/traces` }),
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
  });
  sdk.start();
  process.once("SIGTERM", () => void sdk.shutdown());
}
