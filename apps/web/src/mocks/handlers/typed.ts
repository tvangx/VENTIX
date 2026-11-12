import { http, HttpResponse, type DefaultBodyType, type HttpResponseResolver } from "msw";
import type {
  HttpMethod,
  JsonBodyOf,
  OperationOf,
  PathParamsOf,
  PathsWithMethod,
  SuccessJsonOf,
} from "@/lib/api/openapi-types";
import type { Problem } from "@/lib/api/problem";
import { API_BASE_URL } from "@/lib/http/client";
import { rolesOf, state, type AccessGrant } from "../db";

type ParamsOf<Op> = [PathParamsOf<Op>] extends [never]
  ? Record<string, never>
  : { [K in keyof PathParamsOf<Op>]: string };

type RequestBodyOf<Op> = [JsonBodyOf<Op>] extends [never]
  ? DefaultBodyType
  : JsonBodyOf<Op> extends DefaultBodyType
    ? JsonBodyOf<Op>
    : DefaultBodyType;

type ResponseBodyOf<Op> = [SuccessJsonOf<Op>] extends [void] ? null : SuccessJsonOf<Op>;

type Register<Paths, M extends HttpMethod> = <P extends PathsWithMethod<Paths, M>>(
  path: P,
  resolver: HttpResponseResolver<
    ParamsOf<OperationOf<Paths, P, M>>,
    RequestBodyOf<OperationOf<Paths, P, M>>,
    ResponseBodyOf<OperationOf<Paths, P, M>>
  >,
) => ReturnType<typeof http.get>;

export interface MockService<Paths> {
  /** URL MSW tương ứng một path OpenAPI (dùng cho handler đặc biệt như SSE). */
  url: (path: keyof Paths & string) => string;
  get: Register<Paths, "get">;
  post: Register<Paths, "post">;
  put: Register<Paths, "put">;
  patch: Register<Paths, "patch">;
  delete: Register<Paths, "delete">;
}

/**
 * Đăng ký handler MSW theo path trong OpenAPI của service: sai path/method, sai kiểu body
 * request hoặc response so với hợp đồng sẽ lỗi typecheck.
 * `*` ở đầu để khớp mọi origin (trình duyệt dùng origin của Vite, test dùng http://localhost).
 */
export function mockService<Paths>(prefix: string): MockService<Paths> {
  const url = (path: string) => `*${API_BASE_URL}${prefix}${path.replace(/\{([^}]+)\}/g, ":$1")}`;
  const register =
    (method: HttpMethod) =>
    (path: string, resolver: HttpResponseResolver): ReturnType<typeof http.get> =>
      http[method](url(path), resolver);
  return {
    url,
    get: register("get"),
    post: register("post"),
    put: register("put"),
    patch: register("patch"),
    delete: register("delete"),
  } as unknown as MockService<Paths>;
}

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  503: "Service Unavailable",
};

/**
 * Lỗi RFC 7807 cùng dạng `@ticketing/common` (type `urn:ticketing:problem:<code>`).
 * Trả `HttpResponse<never>` để dùng được trong mọi handler: kiểu body chặt chỉ áp cho phản hồi 2xx,
 * còn lỗi luôn theo ProblemSchema (problem.ts).
 */
export function problem(
  status: number,
  code: string,
  detail: string,
  extensions: Record<string, unknown> = {},
): HttpResponse<never> {
  const body: Problem = {
    ...extensions,
    type: `urn:ticketing:problem:${code.toLowerCase()}`,
    title: TITLES[status] ?? "Error",
    status,
    detail,
    code,
    request_id: crypto.randomUUID(),
  };
  const response = new HttpResponse<string>(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });
  return response as unknown as HttpResponse<never>;
}

export function noContent(): HttpResponse<never> {
  return new HttpResponse(null, { status: 204 }) as HttpResponse<never>;
}

export interface SseWriter {
  send: (event: string, data: string) => void;
  close: () => void;
}

/**
 * Phản hồi `text/event-stream` tự dựng bằng ReadableStream. Không dùng `sse()` của MSW vì nó
 * cần EventSource (Node 20 không có) trong khi frontend đọc SSE bằng fetch để gửi được Authorization.
 * `start` trả về hàm dọn dẹp, gọi khi stream đóng hoặc client ngắt.
 */
export function eventStream(
  request: Request,
  start: (writer: SseWriter) => (() => void) | void,
): HttpResponse<never> {
  const encoder = new TextEncoder();
  let closed = false;
  let cleanup: (() => void) | void;
  const finish = () => {
    if (closed) return false;
    closed = true;
    cleanup?.();
    return true;
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const writer: SseWriter = {
        send: (event, data) => {
          if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        },
        close: () => {
          if (finish()) controller.close();
        },
      };
      request.signal.addEventListener("abort", () => finish());
      cleanup = start(writer);
      if (closed) cleanup?.();
    },
    cancel() {
      finish();
    },
  });
  const response = new HttpResponse<ReadableStream<Uint8Array>>(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
  return response as unknown as HttpResponse<never>;
}

export type AuthResult =
  | { ok: true; grant: AccessGrant; roles: string[] }
  | { ok: false; response: ReturnType<typeof problem> };

/** Đọc `Authorization: Bearer` như auth-guard: thiếu/hết hạn → 401. */
export function authenticate(request: Request): AuthResult {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const grant = state.tokens.get(token);
  if (!grant || grant.expiresAt <= Date.now()) {
    return { ok: false, response: problem(401, "UNAUTHORIZED", "Missing or invalid token") };
  }
  return { ok: true, grant, roles: rolesOf(grant) };
}

/**
 * Idempotency-Key: cùng key + cùng nội dung → trả lại kết quả cũ; khác nội dung → 422.
 * `scope` tách không gian key theo service/endpoint/người dùng.
 */
export function idempotent<T>(
  scope: string,
  key: string,
  payload: unknown,
): { replay: T | null; conflict: boolean; save: (body: T) => void } {
  const storeKey = `${scope}:${key}`;
  const fingerprint = JSON.stringify(payload);
  const existing = state.idempotency.get(storeKey);
  return {
    // Chỉ handler cùng scope ghi key này, nên body đã lưu đúng kiểu T.
    replay: existing && existing.fingerprint === fingerprint ? (existing.body as T) : null,
    conflict: existing !== undefined && existing.fingerprint !== fingerprint,
    save: (body) => state.idempotency.set(storeKey, { fingerprint, body }),
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
