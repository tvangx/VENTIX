import axios from "axios";
import { create } from "zustand";
import { identityApi, SERVICE_PREFIX, type EventPaths } from "@/lib/api";
import { createServiceClient } from "@/lib/api/typed-client";
import { API_BASE_URL } from "@/lib/http/client";
import { installRefreshInterceptor } from "@/lib/http/refresh-interceptor";

// API organizer của event-service đọc `organizerId` trong JWT, nên cần token đã chọn tenant
// (identity: POST /v1/auth/tenants/{organizerId}/token). Token toàn cục của phiên không dùng được.
// Token tenant chỉ giữ trong bộ nhớ như access token chính.

interface TenantState {
  organizerId: string | null;
  token: string | null;
  /** Tăng mỗi lần bỏ token, để giao diện biết phải đổi token mới. */
  epoch: number;
  setTenant: (organizerId: string, token: string) => void;
  clear: () => void;
}

export const useTenantStore = create<TenantState>()((set) => ({
  organizerId: null,
  token: null,
  epoch: 0,
  setTenant: (organizerId, token) => set({ organizerId, token }),
  clear: () => set((s) => ({ organizerId: null, token: null, epoch: s.epoch + 1 })),
}));

/** Đổi token toàn cục lấy token của tenant. Lời gọi này đi qua client chính (tự refresh khi 401). */
export async function exchangeTenantToken(organizerId: string): Promise<string> {
  const { access_token } = await identityApi.post("/v1/auth/tenants/{organizerId}/token", {
    path: { organizerId },
  });
  useTenantStore.getState().setTenant(organizerId, access_token);
  return access_token;
}

export const organizerHttp = axios.create({ baseURL: API_BASE_URL, withCredentials: true });

installRefreshInterceptor(organizerHttp, {
  getAccessToken: () => useTenantStore.getState().token,
  // Token tenant hết hạn: đổi lại từ token toàn cục (refresh cookie do client chính lo).
  refresh: () => {
    const { organizerId } = useTenantStore.getState();
    if (!organizerId) return Promise.reject(new Error("Chưa chọn organizer"));
    return exchangeTenantToken(organizerId);
  },
  onRefreshed: () => {
    // exchangeTenantToken đã lưu token mới.
  },
  // Phiên chính hỏng thì client chính đã chuyển về /login; ở đây chỉ bỏ token tenant.
  onAuthFailure: () => useTenantStore.getState().clear(),
});

/** Client event-service gắn token tenant (chỉ dùng cho /v1/organizer/...). */
export const organizerApi = createServiceClient<EventPaths>(organizerHttp, SERVICE_PREFIX.event);
