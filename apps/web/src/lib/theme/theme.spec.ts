// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  readPreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  useThemeStore,
} from "./theme";

/** jsdom không có matchMedia: giả lập để điều khiển chế độ của "hệ điều hành". */
function stubSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: dark && query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolveTheme: chọn cụ thể thắng, 'system' theo hệ điều hành", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("readPreference: giá trị lạ hoặc storage bị chặn → 'system'", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "tím");
    expect(readPreference()).toBe("system");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(readPreference()).toBe("system");
  });

  it("chọn 'Tối' → lưu lựa chọn và gắn class dark lên <html>", () => {
    stubSystemDark(false);
    useThemeStore.getState().setPreference("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(useThemeStore.getState().resolved).toBe("dark");

    useThemeStore.getState().setPreference("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("'Theo hệ thống' đổi theo hệ điều hành khi syncSystem", () => {
    stubSystemDark(false);
    useThemeStore.getState().setPreference("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    stubSystemDark(true);
    useThemeStore.getState().syncSystem();
    expect(useThemeStore.getState().resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("đang chọn cụ thể thì hệ điều hành đổi cũng không ảnh hưởng", () => {
    stubSystemDark(false);
    useThemeStore.getState().setPreference("light");
    stubSystemDark(true);
    useThemeStore.getState().syncSystem();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("không lưu được localStorage vẫn áp theme cho phiên hiện tại", () => {
    stubSystemDark(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    useThemeStore.getState().setPreference("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applyTheme chỉ bật/tắt class dark", () => {
    const root = document.createElement("html");
    root.classList.add("other");
    applyTheme("dark", root);
    expect([...root.classList]).toEqual(["other", "dark"]);
    applyTheme("light", root);
    expect([...root.classList]).toEqual(["other"]);
  });
});
