// Kiểu tiện ích đọc cấu trúc `paths` do openapi-typescript sinh ra (src/lib/api/generated).
// Dùng chung cho typed client (gọi API thật) và MSW handler (mock) để cả hai bám cùng hợp đồng.

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

/** Các path có method M. Method không có trong spec được sinh dạng `put?: never` nên bị loại. */
export type PathsWithMethod<Paths, M extends HttpMethod> = {
  [K in keyof Paths]: Paths[K] extends { [X in M]: unknown } ? K : never;
}[keyof Paths] &
  string;

export type OperationOf<Paths, P extends keyof Paths, M extends HttpMethod> = Paths[P] extends {
  [X in M]: infer Op;
}
  ? Op
  : never;

export type PathParamsOf<Op> = Op extends { parameters: { path: infer P } } ? P : never;

export type QueryOf<Op> = Op extends { parameters: { query: infer Q } }
  ? { query: Q }
  : Op extends { parameters: { query?: infer Q } }
    ? [Exclude<Q, undefined>] extends [never]
      ? unknown
      : { query?: Exclude<Q, undefined> }
    : unknown;

export type JsonBodyOf<Op> = Op extends {
  requestBody: { content: { "application/json": infer B } };
}
  ? B
  : never;

type BodyOptionOf<Op> = Op extends { requestBody: { content: { "application/json": infer B } } }
  ? { body: B }
  : Op extends { requestBody: { content: { "multipart/form-data": unknown } } }
    ? { body: FormData }
    : unknown;

type PathOptionOf<Op> = [PathParamsOf<Op>] extends [never] ? unknown : { path: PathParamsOf<Op> };

type SuccessStatus = 200 | 201 | 202 | 204;

/** Kiểu body của phản hồi 2xx dạng JSON; `void` khi 2xx không có body (ví dụ 204). */
export type SuccessJsonOf<Op> = Op extends { responses: infer R }
  ? {
      [S in keyof R & SuccessStatus]: R[S] extends { content: { "application/json": infer T } }
        ? T
        : void;
    }[keyof R & SuccessStatus]
  : never;

export type RequestOptionsOf<Op> = PathOptionOf<Op> &
  QueryOf<Op> &
  BodyOptionOf<Op> & {
    /** Header thêm (Idempotency-Key, X-Admission-Token...). Authorization do interceptor gắn. */
    headers?: Record<string, string>;
    signal?: AbortSignal;
  };

/** Tham số options bắt buộc khi operation có path/query/body bắt buộc, ngược lại tùy chọn. */
export type OptionsArg<Op> =
  Record<string, never> extends Omit<RequestOptionsOf<Op>, "headers" | "signal">
    ? [options?: RequestOptionsOf<Op>]
    : [options: RequestOptionsOf<Op>];

/** `/v1/events/{id}` + `{ id: "x" }` → `/v1/events/x` (mã hóa từng tham số). */
export function buildPath(template: string, params?: Record<string, string | number>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const value = params?.[name];
    if (value === undefined) {
      throw new Error(`Missing path parameter "${name}" for ${template}`);
    }
    return encodeURIComponent(String(value));
  });
}
