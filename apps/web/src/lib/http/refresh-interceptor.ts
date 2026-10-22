import {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from "axios";

export interface RefreshInterceptorOptions {
  getAccessToken: () => string | null;
  /** Gọi API refresh, trả access token mới. Ném lỗi nếu phiên không còn hợp lệ. */
  refresh: () => Promise<string>;
  onRefreshed: (accessToken: string) => void;
  /** Refresh thất bại: xóa phiên, chuyển về trang đăng nhập. */
  onAuthFailure: () => void;
  /** Endpoint không được tự refresh khi trả 401 (đăng nhập, refresh) để tránh vòng lặp. */
  skipRefreshUrls?: readonly string[];
}

type RetriableConfig = InternalAxiosRequestConfig & { _authRetried?: boolean };

/**
 * Gắn Bearer token cho mọi request; khi gặp 401 thì refresh đúng một lần cho cả loạt request
 * đang lỗi (single-flight), rồi gửi lại mỗi request tối đa một lần.
 * Trả về hàm gỡ interceptor.
 */
export function installRefreshInterceptor(
  client: AxiosInstance,
  options: RefreshInterceptorOptions,
): () => void {
  const skipUrls = options.skipRefreshUrls ?? [];
  let inflightRefresh: Promise<string> | null = null;

  const refreshOnce = (): Promise<string> => {
    if (!inflightRefresh) {
      inflightRefresh = options
        .refresh()
        .then((token) => {
          options.onRefreshed(token);
          return token;
        })
        .catch((error: unknown) => {
          options.onAuthFailure();
          throw error;
        })
        .finally(() => {
          inflightRefresh = null;
        });
    }
    return inflightRefresh;
  };

  const requestId = client.interceptors.request.use((config) => {
    const token = options.getAccessToken();
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
    }
    return config;
  });

  const responseId = client.interceptors.response.use(undefined, async (error: unknown) => {
    if (!(error instanceof AxiosError) || error.response?.status !== 401 || !error.config) {
      throw error;
    }
    const config = error.config as RetriableConfig;
    const url = config.url ?? "";
    if (config._authRetried || skipUrls.some((skip) => url.includes(skip))) {
      throw error;
    }

    // Request gửi bằng token cũ trong lúc loạt refresh trước đã xong: dùng luôn token mới,
    // không refresh lần nữa (refresh token xoay vòng, gọi thừa dễ bị coi là tái sử dụng).
    const sentAuth = AxiosHeaders.from(config.headers).get("Authorization");
    const current = options.getAccessToken();
    const token =
      current && sentAuth !== `Bearer ${current}` && !inflightRefresh
        ? current
        : await refreshOnce();
    config._authRetried = true;
    config.headers = AxiosHeaders.from(config.headers);
    config.headers.set("Authorization", `Bearer ${token}`);
    return client.request(config);
  });

  return () => {
    client.interceptors.request.eject(requestId);
    client.interceptors.response.eject(responseId);
  };
}
