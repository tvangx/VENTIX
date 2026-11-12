import type { AxiosInstance } from "axios";
import {
  buildPath,
  type HttpMethod,
  type OperationOf,
  type OptionsArg,
  type PathsWithMethod,
  type SuccessJsonOf,
} from "./openapi-types";

interface RawOptions {
  path?: Record<string, string | number>;
  query?: object;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

type Caller<Paths, M extends HttpMethod> = <P extends PathsWithMethod<Paths, M>>(
  path: P,
  ...options: OptionsArg<OperationOf<Paths, P, M>>
) => Promise<SuccessJsonOf<OperationOf<Paths, P, M>>>;

export interface ServiceClient<Paths> {
  get: Caller<Paths, "get">;
  post: Caller<Paths, "post">;
  put: Caller<Paths, "put">;
  patch: Caller<Paths, "patch">;
  delete: Caller<Paths, "delete">;
}

/**
 * Client có kiểu chặt theo `paths` sinh từ OpenAPI của một service, chạy trên instance axios
 * truyền vào (thường là `apiClient` đã gắn interceptor refresh token).
 * `prefix` là đoạn route Kong của service, ví dụ `/identity` → `/api/identity/v1/...`.
 * Lỗi HTTP ném AxiosError như cũ; đọc chi tiết bằng `toProblem` (problem.ts).
 */
export function createServiceClient<Paths>(
  http: AxiosInstance,
  prefix: string,
): ServiceClient<Paths> {
  const call =
    (method: HttpMethod) =>
    async (path: string, options?: RawOptions): Promise<unknown> => {
      const response = await http.request({
        method,
        url: `${prefix}${buildPath(path, options?.path)}`,
        params: options?.query,
        data: options?.body,
        headers: options?.headers,
        signal: options?.signal,
      });
      return response.status === 204 ? undefined : response.data;
    };

  // Kiểu chặt nằm ở chữ ký Caller; phần cài đặt dùng chung một hàm không phụ thuộc kiểu.
  return {
    get: call("get"),
    post: call("post"),
    put: call("put"),
    patch: call("patch"),
    delete: call("delete"),
  } as unknown as ServiceClient<Paths>;
}
