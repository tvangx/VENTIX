import { AxiosError, AxiosHeaders, type AxiosResponse } from "axios";
import { describe, expect, it } from "vitest";
import { authErrorMessage, NETWORK_ERROR_MESSAGE } from "./errors";
import { loginPathFor, safeNextPath } from "./redirect";
import { fieldErrors, loginSchema, registerSchema } from "./validation";

function axiosError(status: number | null, data?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  const response =
    status === null
      ? undefined
      : ({ status, data, statusText: "", headers: {}, config } as AxiosResponse);
  return new AxiosError("request failed", "ERR", config, undefined, response);
}

function problem(status: number, code: string) {
  return { type: `urn:ticketing:problem:${code}`, title: "x", status, code, detail: "raw detail" };
}

describe("safeNextPath", () => {
  it.each([
    ["/account", "/account"],
    ["/explore?q=jazz#top", "/explore?q=jazz#top"],
    [null, "/"],
    ["", "/"],
    ["account", "/"],
    ["//evil.example/x", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["/login", "/"],
    ["/auth/callback?provider=google", "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it("loginPathFor mã hóa next, bỏ next khi là trang chủ", () => {
    expect(loginPathFor("/tickets?tab=upcoming")).toBe("/login?next=%2Ftickets%3Ftab%3Dupcoming");
    expect(loginPathFor("/")).toBe("/login");
    expect(loginPathFor("//evil.example")).toBe("/login");
  });
});

describe("authErrorMessage", () => {
  it("mã lỗi đã biết → câu tiếng Việt, không lộ detail của backend", () => {
    expect(authErrorMessage(axiosError(401, problem(401, "INVALID_CREDENTIALS")))).toBe(
      "Email hoặc mật khẩu chưa đúng.",
    );
    expect(authErrorMessage(axiosError(409, problem(409, "EMAIL_EXISTS")))).toMatch(/đã có/);
  });

  it("429 → nhắc đợi; mã lạ → câu chung", () => {
    expect(authErrorMessage(axiosError(429, problem(429, "RATE_LIMITED")))).toMatch(/quá nhiều/);
    const message = authErrorMessage(axiosError(400, problem(400, "SOMETHING_NEW")));
    expect(message).toBe("Có lỗi xảy ra. Thử lại sau.");
  });

  it("mất mạng hoặc 5xx không có problem+json → báo không kết nối được", () => {
    expect(authErrorMessage(axiosError(null))).toBe(NETWORK_ERROR_MESSAGE);
    expect(authErrorMessage(axiosError(502, "<html>Bad Gateway</html>"))).toBe(
      NETWORK_ERROR_MESSAGE,
    );
  });
});

describe("validation", () => {
  it("đăng ký: mật khẩu 12–128 ký tự theo OpenAPI identity", () => {
    expect(registerSchema.safeParse({ email: "a@b.vn", password: "x".repeat(11) }).success).toBe(
      false,
    );
    expect(registerSchema.safeParse({ email: "a@b.vn", password: "x".repeat(12) }).success).toBe(
      true,
    );
    expect(registerSchema.safeParse({ email: "a@b.vn", password: "x".repeat(129) }).success).toBe(
      false,
    );
  });

  it("email được cắt khoảng trắng; lỗi lấy câu đầu tiên của mỗi trường", () => {
    const ok = loginSchema.safeParse({ email: "  a@b.vn ", password: "p" });
    expect(ok.success && ok.data.email).toBe("a@b.vn");

    const bad = loginSchema.safeParse({ email: "", password: "" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(fieldErrors(bad.error)).toEqual({ email: "Nhập email.", password: "Nhập mật khẩu." });
    }
  });
});
