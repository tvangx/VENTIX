import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** Khóa localStorage; script trong index.html đọc cùng khóa để áp theme trước khi React chạy. */
export const THEME_STORAGE_KEY = "ventix.theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

const PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

function isPreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (PREFERENCES as readonly string[]).includes(value);
}

// localStorage có thể bị chặn (chế độ riêng tư, tắt cookie): khi đó chỉ không nhớ lựa chọn.
export function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(saved) ? saved : "system";
  } catch {
    return "system";
  }
}

function savePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Không lưu được thì vẫn áp theme cho phiên hiện tại.
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }
  return preference;
}

export function applyTheme(resolved: ResolvedTheme, root: HTMLElement = document.documentElement) {
  root.classList.toggle("dark", resolved === "dark");
}

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
  /** Gọi khi hệ điều hành đổi chế độ sáng/tối; chỉ có tác dụng khi đang chọn "theo hệ thống". */
  syncSystem: () => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => {
  const preference = readPreference();
  return {
    preference,
    resolved: resolveTheme(preference, systemPrefersDark()),
    setPreference: (next) => {
      const resolved = resolveTheme(next, systemPrefersDark());
      savePreference(next);
      applyTheme(resolved);
      set({ preference: next, resolved });
    },
    syncSystem: () => {
      const resolved = resolveTheme(get().preference, systemPrefersDark());
      applyTheme(resolved);
      set({ resolved });
    },
  };
});
