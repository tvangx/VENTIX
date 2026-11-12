import { create } from "zustand";

/**
 * - `unknown`: vừa tải trang, đang thử khôi phục phiên bằng refresh cookie.
 * - `authenticated`: có access token trong bộ nhớ.
 * - `anonymous`: chưa đăng nhập hoặc phiên đã hết.
 */
export type SessionStatus = "unknown" | "authenticated" | "anonymous";

interface AuthState {
  accessToken: string | null;
  status: SessionStatus;
  setAccessToken: (token: string) => void;
  clearSession: () => void;
}

// Access token chỉ giữ trong bộ nhớ (không localStorage) để giảm thiệt hại khi bị XSS;
// tải lại trang thì lấy token mới qua refresh (refresh token nằm trong cookie httpOnly).
export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  status: "unknown",
  setAccessToken: (token) => set({ accessToken: token, status: "authenticated" }),
  clearSession: () => set({ accessToken: null, status: "anonymous" }),
}));
