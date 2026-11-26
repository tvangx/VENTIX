import "reflect-metadata";
import { Controller, Get, HttpException, INestApplication, Param, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { MetricsController, MetricsMiddleware, MetricsService } from "../../src/metrics/metrics";
import { SERVICE_NAME } from "../../src/service.constants";

@Controller("things")
class FixtureController {
  @Get(":id")
  get(@Param("id") id: string): { id: string } {
    return { id };
  }
  @Get(":id/denied")
  @UseGuards({ canActivate: () => false })
  denied(): void {}
  @Get(":id/fail")
  fail(): never {
    throw new HttpException("fixture failure", 503);
  }
}

describe("HTTP metrics (real Nest/Express requests)", () => {
  let app: INestApplication;
  let metrics: MetricsService;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FixtureController, MetricsController],
      providers: [MetricsService],
    }).compile();
    app = module.createNestApplication({ logger: false });
    metrics = module.get(MetricsService);
    const middleware = new MetricsMiddleware(metrics);
    const use = (req: Request, res: Response, next: NextFunction) => middleware.use(req, res, next);
    // ??ng k? l?p c? ?: m?t response ch? ???c ghi m?t l?n.
    app.use(use);
    app.use(use);
    app.setGlobalPrefix("v1", { exclude: ["metrics"] });
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  async function counts() {
    const metric = await metrics.http.duration.get();
    return metric.values.filter((value) => value.metricName?.endsWith("_count"));
  }
  it("records successful dynamic routes once without IDs or query values", async () => {
    await request(app.getHttpServer())
      .get("/v1/things/private-id-a?user_id=private-user")
      .expect(200);
    await request(app.getHttpServer()).get("/v1/things/private-id-b").expect(200);
    const values = await counts();
    expect(values).toContainEqual(
      expect.objectContaining({
        value: 2,
        labels: {
          service: SERVICE_NAME,
          method: "GET",
          route: "/v1/things/:id",
          status_class: "2xx",
        },
      }),
    );
    expect(JSON.stringify(values)).not.toMatch(/private-id|private-user|user_id/);
  });
  it("records the final error status and normalized route", async () => {
    await request(app.getHttpServer()).get("/v1/things/private-id/fail").expect(503);
    expect(await counts()).toContainEqual(
      expect.objectContaining({
        value: 1,
        labels: {
          service: SERVICE_NAME,
          method: "GET",
          route: "/v1/things/:id/fail",
          status_class: "5xx",
        },
      }),
    );
  });
  it("records errors raised by guards before the controller", async () => {
    await request(app.getHttpServer()).get("/v1/things/private-id/denied").expect(403);
    expect(await counts()).toContainEqual(
      expect.objectContaining({
        value: 1,
        labels: {
          service: SERVICE_NAME,
          method: "GET",
          route: "/v1/things/:id/denied",
          status_class: "4xx",
        },
      }),
    );
  });
  it("collapses arbitrary 404 paths into unmatched", async () => {
    await request(app.getHttpServer()).get("/unknown/private-id-a").expect(404);
    await request(app.getHttpServer()).get("/another/private-id-b?token=private-token").expect(404);
    expect(await counts()).toContainEqual(
      expect.objectContaining({
        value: 2,
        labels: {
          service: SERVICE_NAME,
          method: "GET",
          route: "unmatched",
          status_class: "4xx",
        },
      }),
    );
  });
  it("scrapes keep HTTP counters unchanged, preserve endpoint, and remove the old histogram", async () => {
    const before = await counts();
    for (const path of ["/metrics", "/metrics?ignored=1", "/metrics/"]) {
      const response = await request(app.getHttpServer()).get(path).expect(200);
      expect(response.headers["content-type"]).toContain("text/plain");
      expect(response.text).toContain("http_server_request_duration_seconds_bucket");
      expect(response.text).not.toContain("http_request_duration_seconds");
    }
    expect(await counts()).toEqual(before);
  });
});
