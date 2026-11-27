import { HttpException } from "@nestjs/common";
import { Writable } from "node:stream";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  ProblemException,
  ProblemJsonFilter,
  RequestIdMiddleware,
  createLogger,
  loadEnv,
  requestContext,
  RotatingLogDestination,
} from "../src";

function fakeHost(req: Record<string, unknown> = {}) {
  const res = {
    statusCode: 0,
    contentType: "",
    payload: undefined as Record<string, unknown> | undefined,
    status(s: number) {
      this.statusCode = s;
      return this;
    },
    type(t: string) {
      this.contentType = t;
      return this;
    },
    json(b: Record<string, unknown>) {
      this.payload = b;
      return this;
    },
  };
  const host = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  return { host: host as never, res };
}

describe("loadEnv", () => {
  const schema = z.object({ PORT: z.coerce.number().int(), NAME: z.string().min(1) });

  it("parses valid env", () => {
    expect(loadEnv(schema, { PORT: "3001", NAME: "x" })).toEqual({ PORT: 3001, NAME: "x" });
  });

  it("fails fast and does not leak values", () => {
    expect(() => loadEnv(schema, { PORT: "abc-secret", NAME: "" })).toThrow(/PORT/);
    try {
      loadEnv(schema, { PORT: "abc-secret", NAME: "" });
    } catch (e) {
      expect((e as Error).message).not.toContain("abc-secret");
    }
  });
});

describe("RotatingLogDestination", () => {
  it("rotates JSON files without throwing to the caller", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ticketing-log-"));
    const path = join(directory, "service.log");
    const destination = new RotatingLogDestination(path, 20, 2);
    destination.write('{"n":1}\n');
    destination.write('{"n":2,"extra":"rotation"}\n');
    await destination.flush();
    expect(await readdir(directory)).toContain("service.log.1");
    expect(await readFile(path, "utf8")).toContain('"n":2');
  });
});

describe("RequestIdMiddleware", () => {
  const mw = new RequestIdMiddleware();

  function run(headers: Record<string, string>) {
    const headersOut: Record<string, string> = {};
    const req = { headers } as never;
    const res = { setHeader: (k: string, v: string) => (headersOut[k] = v) } as never;
    let inside: ReturnType<typeof requestContext.get>;
    mw.use(req, res, () => {
      inside = requestContext.get();
    });
    return { headersOut, inside, req: req as { id: string } };
  }

  it("generates a request id when absent", () => {
    const r = run({});
    expect(r.headersOut["X-Request-Id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.inside?.requestId).toBe(r.headersOut["X-Request-Id"]);
  });

  it("keeps a safe incoming id", () => {
    expect(run({ "x-request-id": "abc-123" }).headersOut["X-Request-Id"]).toBe("abc-123");
  });

  it("replaces an unsafe incoming id", () => {
    const r = run({ "x-request-id": "bad id\nINJECT" });
    expect(r.headersOut["X-Request-Id"]).not.toContain("INJECT");
  });

  it("extracts trace id from traceparent", () => {
    const tid = "0af7651916cd43dd8448eb211c80319c";
    const r = run({ traceparent: `00-${tid}-b7ad6b7169203331-01` });
    expect(r.inside?.traceId).toBe(tid);
  });
});

describe("createLogger", () => {
  it("emits JSON with service, request_id, trace_id and redacts tokens", () => {
    const lines: string[] = [];
    const dest = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const log = createLogger("svc", { destination: dest });
    requestContext.run({ requestId: "rid-1", traceId: "tid-1" }, () => {
      log.info({ req: { headers: { authorization: "Bearer SECRET" } } }, "hello");
    });
    const out = JSON.parse(lines[0]);
    expect(out).toMatchObject({
      service: "svc",
      request_id: "rid-1",
      trace_id: "tid-1",
      msg: "hello",
    });
    expect(lines[0]).not.toContain("SECRET");
  });
});

describe("ProblemJsonFilter", () => {
  const filter = new ProblemJsonFilter();

  it("renders ProblemException as problem+json with request_id", () => {
    const { host, res } = fakeHost({ id: "rid-9" });
    filter.catch(new ProblemException("SEAT_UNAVAILABLE", 409, "Ghế đã được giữ"), host);
    expect(res.statusCode).toBe(409);
    expect(res.contentType).toBe("application/problem+json");
    expect(res.payload).toMatchObject({
      status: 409,
      code: "SEAT_UNAVAILABLE",
      detail: "Ghế đã được giữ",
      request_id: "rid-9",
    });
    expect(res.payload?.type).toBeDefined();
    expect(res.payload?.title).toBeDefined();
  });

  it("maps validation errors to VALIDATION_FAILED", () => {
    const { host, res } = fakeHost();
    filter.catch(new HttpException({ message: ["a must be x", "b required"] }, 400), host);
    expect(res.payload).toMatchObject({ status: 400, code: "VALIDATION_FAILED" });
    expect(res.payload?.detail).toBe("a must be x; b required");
  });

  it("does not leak internals for unknown errors", () => {
    const { host, res } = fakeHost();
    filter.catch(new Error("db password=hunter2 at stack..."), host);
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.payload)).not.toContain("hunter2");
    expect(res.payload?.code).toBe("INTERNAL_ERROR");
  });
});
