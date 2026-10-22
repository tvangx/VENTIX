import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  setAccessToken: (token: string) => void;
  clearSession: () => void;
}

// Access token chỉ giữ trong bộ nhớ (không localStorage) để giảm thiệt hại khi bị XSS;
// tải lại trang thì lấy token mới qua refresh (refresh token nằm trong cookie httpOnly).
export const useAuthStore = create<AuthState>()((set) => ({
  accessToken: null,
  setAccessToken: (token) => set({ accessToken: token }),
  clearSession: () => set({ accessToken: null }),
}));
