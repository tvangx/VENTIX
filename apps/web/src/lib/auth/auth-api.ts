import { useQuery, type QueryClient } from "@tanstack/react-query";
import { identityApi } from "@/lib/api";
import { useAuthStore } from "@/lib/http/auth-store";
import type { Credentials } from "./validation";

export const ME_QUERY_KEY = ["identity", "me"] as const;

/** Lệnh điều hướng ra ngoài SPA (trang Google); tách ra để test thay được. */
export const browser = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

export async function login(credentials: Credentials): Promise<void> {
  const { access_token } = await identityApi.post("/v1/auth/login", { body: credentials });
  useAuthStore.getState().setAccessToken(access_token);
}

/**
 * Đăng ký với Idempotency-Key do form giữ: gửi lại cùng nội dung dùng cùng key (identity trả
 * lại kết quả cũ), đổi nội dung thì form tạo key mới.
 */
export async function register(credentials: Credentials, idempotencyKey: string): Promise<void> {
  await identityApi.post("/v1/auth/register", {
    body: credentials,
    headers: { "Idempotency-Key": idempotencyKey },
  });
}

export async function logout(queryClient: QueryClient): Promise<void> {
  try {
    await identityApi.post("/v1/auth/logout");
  } finally {
    // Dù server lỗi vẫn xóa phiên ở trình duyệt; cookie hết hạn sẽ tự vô hiệu.
    useAuthStore.getState().clearSession();
    queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
  }
}

/** Lấy URL Google (PKCE, state do identity giữ trong cookie) rồi rời SPA để đăng nhập. */
export async function startGoogleLogin(): Promise<void> {
  const { authorization_url } = await identityApi.get("/v1/auth/google/start");
  browser.assign(authorization_url);
}

export function useMe() {
  const status = useAuthStore((state) => state.status);
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => identityApi.get("/v1/auth/me"),
    enabled: status === "authenticated",
  });
}
