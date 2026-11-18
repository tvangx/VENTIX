import request from "supertest";
import { randomUUID } from "node:crypto";
import { fixture } from "../support/ticket";

describe("S-503 public verification rate limit", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture({ VERIFY_RATE_PER_PEER: 10, VERIFY_RATE_TOTAL: 20 });
    await context.app.listen(0, "127.0.0.1");
  });
  afterAll(async () => {
    await context?.close();
  });
  it("allows 10 of 50 concurrent requests; spoofed forwarding does not bypass it", async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        request(context.app.getHttpServer())
          .get(`/v1/public/tickets/${randomUUID()}`)
          .set("X-Forwarded-For", `192.0.2.${index}`),
      ),
    );
    expect(responses.filter((response) => response.status === 404)).toHaveLength(10);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(40);
    const limited = responses.find((response) => response.status === 429)!;
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.body.code).toBe("VERIFY_RATE_LIMITED");
    await request(context.app.getHttpServer()).get("/v1/verify").expect(429);
  });
});
