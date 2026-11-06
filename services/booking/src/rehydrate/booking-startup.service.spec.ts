import { createLogger } from "@ticketing/common";
import { envSchema } from "../config/env.schema";
import { BookingStartupService } from "./booking-startup.service";

describe("startup readiness gate", () => {
  const env = envSchema.parse({
    DATABASE_URL: "postgresql://booking_user:test@localhost/booking_db",
    AUTH_ISSUER: "test",
    AUTH_AUDIENCE: "test",
    AUTH_JWKS_URI: "http://localhost/jwks",
  });
  const logger = createLogger("test", { level: "silent" });
  it("stays unready until rehydrate and consumer start both finish", async () => {
    let finish!: () => void;
    const rehydrate = {
      run: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const lifecycle = {
      start: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
    };
    const service = new BookingStartupService(env, logger, rehydrate, lifecycle);
    service.onApplicationBootstrap();
    expect(service.ready).toBe(false);
    expect(lifecycle.start).not.toHaveBeenCalled();
    finish();
    await service.completion;
    expect(service.ready).toBe(true);
    await service.beforeApplicationShutdown();
    expect(service.ready).toBe(false);
    expect(lifecycle.stop).toHaveBeenCalledTimes(1);
  });
  it("keeps readiness false when rehydrate fails and does not start Kafka", async () => {
    const lifecycle = { start: jest.fn(), stop: jest.fn() };
    const service = new BookingStartupService(
      env,
      logger,
      {
        run: async () => {
          throw new Error("Redis unavailable");
        },
      },
      lifecycle,
    );
    service.onApplicationBootstrap();
    await service.completion;
    expect(service.ready).toBe(false);
    expect(lifecycle.start).not.toHaveBeenCalled();
  });
  it("allows explicit flags to skip rehydrate and consumer", async () => {
    const rehydrate = { run: jest.fn() };
    const lifecycle = { start: jest.fn(), stop: jest.fn() };
    const service = new BookingStartupService(
      { ...env, REHYDRATE_ENABLED: false, EVENT_CONSUMER_ENABLED: false },
      logger,
      rehydrate,
      lifecycle,
    );
    service.onApplicationBootstrap();
    await service.completion;
    expect(service.ready).toBe(true);
    expect(rehydrate.run).not.toHaveBeenCalled();
    expect(lifecycle.start).not.toHaveBeenCalled();
  });
  it("stays unready when consumer startup fails", async () => {
    const service = new BookingStartupService(
      env,
      logger,
      { run: async () => undefined },
      {
        start: async () => {
          throw new Error("Kafka unavailable");
        },
        stop: async () => undefined,
      },
    );
    service.onApplicationBootstrap();
    await service.completion;
    expect(service.ready).toBe(false);
  });
  it("drains pending initialization before stopping the consumer without becoming ready", async () => {
    let finish!: () => void;
    const lifecycle = {
      start: jest.fn(async () => undefined),
      stop: jest.fn(async () => undefined),
    };
    const service = new BookingStartupService(
      env,
      logger,
      {
        run: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      },
      lifecycle,
    );
    service.onApplicationBootstrap();
    const closing = service.beforeApplicationShutdown();
    expect(lifecycle.stop).not.toHaveBeenCalled();
    finish();
    await closing;
    expect(service.ready).toBe(false);
    expect(lifecycle.stop).toHaveBeenCalledTimes(1);
  });
});
