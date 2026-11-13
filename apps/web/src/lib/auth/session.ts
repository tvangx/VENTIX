import { refreshAccessToken } from "@/lib/http/client";
import { useAuthStore } from "@/lib/http/auth-store";

let inflight: Promise<void> | null = null;

/**
 * Khôi phục phiên khi tải trang: đổi refresh cookie lấy access token, chỉ một lần.
 * Single-flight vì refresh token xoay vòng: hai lời gọi song song (StrictMode chạy effect hai lần,
 * hoặc trang callback Google) sẽ dùng lại token cũ và identity thu hồi cả family.
 */
export function restoreSession(): Promise<void> {
  if (useAuthStore.getState().status !== "unknown") {
    return Promise.resolve();
  }
  if (!inflight) {
    inflight = refreshAccessToken()
      .then((token) => useAuthStore.getState().setAccessToken(token))
      .catch(() => useAuthStore.getState().clearSession())
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
