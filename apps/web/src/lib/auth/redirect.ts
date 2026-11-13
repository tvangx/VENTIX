/** Trang auth: quay lại đây sau đăng nhập sẽ tạo vòng lặp nên bỏ qua. */
const AUTH_PATHS = ["/login", "/register", "/auth/callback"];

/** Khóa sessionStorage giữ trang cần quay về trong lúc đi qua Google. */
export const NEXT_STORAGE_KEY = "ventix.auth.next";

/**
 * Chỉ nhận đường dẫn nội bộ (bắt đầu bằng một dấu "/") để `?next=` không thành open redirect:
 * loại `//evil.com`, `/\evil.com`, `https://...`, `javascript:`.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return "/";
  }
  const base = "http://ventix.invalid";
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return "/";
  }
  if (url.origin !== base || AUTH_PATHS.includes(url.pathname)) {
    return "/";
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function loginPathFor(next: string): string {
  const safe = safeNextPath(next);
  return safe === "/" ? "/login" : `/login?next=${encodeURIComponent(safe)}`;
}

export function rememberNext(next: string): void {
  try {
    window.sessionStorage.setItem(NEXT_STORAGE_KEY, safeNextPath(next));
  } catch {
    // Không nhớ được thì sau Google về trang chủ.
  }
}

export function takeRememberedNext(): string {
  try {
    const saved = window.sessionStorage.getItem(NEXT_STORAGE_KEY);
    window.sessionStorage.removeItem(NEXT_STORAGE_KEY);
    return safeNextPath(saved);
  } catch {
    return "/";
  }
}
