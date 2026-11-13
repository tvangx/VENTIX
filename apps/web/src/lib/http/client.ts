import axios from "axios";
import { loginPathFor } from "@/lib/auth/redirect";
import { useAuthStore } from "./auth-store";
import { installRefreshInterceptor } from "./refresh-interceptor";

// Đi qua Kong: /api/<service>/v1/... (dev: Vite proxy sang localhost:8000).
export const API_BASE_URL = "/api";

// Khớp OpenAPI identity (S-106): POST /v1/auth/refresh trả { access_token }.
export const REFRESH_PATH = "/identity/v1/auth/refresh";
export const LOGIN_PATH = "/identity/v1/auth/login";

interface RefreshResponse {
  access_token: string;
}

export const apiClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true });

// Instance riêng không gắn interceptor để lời gọi refresh không tự kích hoạt refresh.
const refreshClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true });

/** Xoay refresh token (cookie HttpOnly) lấy access token mới; không đi qua interceptor. */
export async function refreshAccessToken(): Promise<string> {
  const { data } = await refreshClient.post<RefreshResponse>(REFRESH_PATH);
  if (typeof data?.access_token !== "string" || data.access_token.length === 0) {
    throw new Error("Refresh response missing access_token");
  }
  return data.access_token;
}

installRefreshInterceptor(apiClient, {
  getAccessToken: () => useAuthStore.getState().accessToken,
  refresh: refreshAccessToken,
  onRefreshed: (token) => useAuthStore.getState().setAccessToken(token),
  onAuthFailure: () => {
    useAuthStore.getState().clearSession();
    const { pathname, search } = window.location;
    if (pathname !== "/login") {
      window.location.assign(loginPathFor(`${pathname}${search}`));
    }
  },
  skipRefreshUrls: [REFRESH_PATH, LOGIN_PATH],
});
