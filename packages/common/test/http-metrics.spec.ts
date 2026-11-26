import type { NextFunction, Request, Response } from "express";
import { EventEmitter } from "node:events";
import { Registry } from "prom-client";
import { HttpMetrics } from "../src";

function response() {
  const event = new EventEmitter() as EventEmitter & { statusCode: number };
  event.statusCode = 200;
  return { event, res: event as unknown as Response };
}
function request(originalUrl: string, path?: string, method = "GET") {
  return {
    originalUrl,
    path: "/",
    method,
    baseUrl: "/private-id",
    route: path ? { path } : undefined,
  } as Request;
}
const next: NextFunction = () => {};

describe("HttpMetrics", () => {
  let metrics: HttpMetrics;
  beforeEach(() => {
    metrics = new HttpMetrics(new Registry(), "test");
  });
  async function counts() {
    return (await metrics.duration.get()).values.filter((value) =>
      value.metricName?.endsWith("_count"),
    );
  }
  it("reads final route/status on finish and records a response once", async () => {
    const req = request("/orders/private-id?token=private-token");
    const { event, res } = response();
    metrics.observe(req, res, next);
    metrics.observe(req, res, next);
    expect(await counts()).toEqual([]);
    req.route = { path: "/orders/:id" };
    event.statusCode = 503;
    event.emit("finish");
    event.emit("finish");
    expect(await counts()).toEqual([
      expect.objectContaining({
        value: 1,
        labels: {
          service: "test",
          method: "GET",
          route: "/orders/:id",
          status_class: "5xx",
        },
      }),
    ]);
  });
  it.each(["/metrics", "/metrics/", "/metrics?token=private-token", "/METRICS"])(
    "does not measure scrape %s despite mounted req.path",
    async (originalUrl) => {
      const { event, res } = response();
      metrics.observe(request(originalUrl, "/metrics"), res, next);
      event.emit("finish");
      expect(await counts()).toEqual([]);
    },
  );
  it.each([undefined, "*", "/*"])(
    "maps unmatched/wildcard route %s to a bounded label",
    async (route) => {
      const { event, res } = response();
      event.statusCode = 404;
      metrics.observe(
        request("/private-id?token=private-token", route, "PRIVATE-METHOD"),
        res,
        next,
      );
      event.emit("finish");
      expect(await counts()).toEqual([
        expect.objectContaining({
          labels: {
            service: "test",
            method: "OTHER",
            route: "unmatched",
            status_class: "4xx",
          },
        }),
      ]);
    },
  );
});
