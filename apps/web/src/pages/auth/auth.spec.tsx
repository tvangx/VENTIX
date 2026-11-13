// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { browser } from "@/lib/auth/auth-api";
import { NEXT_STORAGE_KEY } from "@/lib/auth/redirect";
import { useAuthStore } from "@/lib/http/auth-store";
import { DEMO_PASSWORD, DEMO_USERS, setRefreshSession, state } from "@/mocks/db";
import { mockServer } from "@/mocks/node";
import { renderApp, setupAppHarness } from "@/test/app-harness";

setupAppHarness();

const NEW_PASSWORD = "mat-khau-moi-2026";

async function fillAndSubmit(email: string, password: string, submit: RegExp) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Mật khẩu"), password);
  await user.click(screen.getByRole("button", { name: submit }));
  return user;
}

/** Đếm request tới một path (MSW node) để kiểm tra form không gọi API khi chưa hợp lệ. */
function recordRequests(pathPart: string) {
  const seen: Request[] = [];
  const listener = ({ request }: { request: Request }) => {
    if (new URL(request.url).pathname.endsWith(pathPart)) seen.push(request.clone());
  };
  mockServer.events.on("request:start", listener);
  return seen;
}

describe("đăng nhập bằng email", () => {
  it("đúng mật khẩu → có token và quay về trang next", async () => {
    const { router } = renderApp("/login?next=%2Faccount");
    await fillAndSubmit(DEMO_USERS.user.email, DEMO_PASSWORD, /vào cửa/i);

    await waitFor(() => expect(router.state.location.pathname).toBe("/account"));
    expect(await screen.findByText(DEMO_USERS.user.email)).toBeTruthy();
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("sai mật khẩu → báo lỗi tiếng Việt, không có phiên", async () => {
    const { router } = renderApp("/login");
    await fillAndSubmit(DEMO_USERS.user.email, "khong-dung-mat-khau", /vào cửa/i);

    expect((await screen.findByRole("alert")).textContent).toBe("Email hoặc mật khẩu chưa đúng.");
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(router.state.location.pathname).toBe("/login");
  });

  it("thiếu email/mật khẩu → báo lỗi tại ô nhập, không gọi API", async () => {
    const calls = recordRequests("/v1/auth/login");
    renderApp("/login");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "khong-phai-email");
    await user.click(screen.getByRole("button", { name: /vào cửa/i }));

    expect(await screen.findByText("Email chưa đúng định dạng.")).toBeTruthy();
    expect(screen.getByText("Nhập mật khẩu.")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText("Email"));
    expect(calls).toHaveLength(0);
  });

  it("next trỏ ra ngoài site bị bỏ qua (chống open redirect)", async () => {
    const { router } = renderApp("/login?next=%2F%2Fevil.example%2Fsteal");
    await fillAndSubmit(DEMO_USERS.user.email, DEMO_PASSWORD, /vào cửa/i);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("đã đăng nhập mà mở /login → đi thẳng tới next", async () => {
    setRefreshSession(DEMO_USERS.user.id);
    const { router } = renderApp("/login?next=%2Ftickets");
    await waitFor(() => expect(router.state.location.pathname).toBe("/tickets"));
  });
});

describe("đăng ký", () => {
  it("tạo tài khoản → tự đăng nhập → về trang chủ", async () => {
    const { router } = renderApp("/register");
    await fillAndSubmit("moi@ventix.test", NEW_PASSWORD, /tạo tài khoản/i);

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(await screen.findAllByRole("button", { name: "Đăng xuất" })).not.toHaveLength(0);
  });

  it("mật khẩu ngắn hơn 12 ký tự → báo lỗi, không gọi API", async () => {
    const calls = recordRequests("/v1/auth/register");
    renderApp("/register");
    await fillAndSubmit("moi@ventix.test", "ngan", /tạo tài khoản/i);

    expect(await screen.findByText("Mật khẩu cần ít nhất 12 ký tự.")).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("email đã có → báo lỗi", async () => {
    renderApp("/register");
    await fillAndSubmit(DEMO_USERS.user.email, NEW_PASSWORD, /tạo tài khoản/i);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Email này đã có tài khoản. Hãy đăng nhập.",
    );
    expect(useAuthStore.getState().status).not.toBe("authenticated");
  });

  it("gửi lại sau lỗi mạng dùng cùng Idempotency-Key; đổi nội dung thì key mới", async () => {
    const calls = recordRequests("/v1/auth/register");
    // Hai lần đầu lỗi 503 như gateway chập chờn; lần ba đi tới handler mock thật.
    mockServer.use(
      http.post("*/api/identity/v1/auth/register", () => new HttpResponse(null, { status: 503 }), {
        once: true,
      }),
      http.post("*/api/identity/v1/auth/register", () => new HttpResponse(null, { status: 503 }), {
        once: true,
      }),
    );
    const { router } = renderApp("/register");
    const user = await fillAndSubmit("moi@ventix.test", NEW_PASSWORD, /tạo tài khoản/i);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Không kết nối được máy chủ. Thử lại sau.",
    );

    await user.click(screen.getByRole("button", { name: /tạo tài khoản/i }));
    await waitFor(() => expect(calls).toHaveLength(2));
    await user.type(screen.getByLabelText("Mật khẩu"), "-khac");
    await user.click(screen.getByRole("button", { name: /tạo tài khoản/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));

    const keys = calls.map((request) => request.headers.get("Idempotency-Key"));
    expect(keys).toHaveLength(3);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(state.users.has("moi@ventix.test")).toBe(true);
  });
});

describe("đăng nhập Google", () => {
  it("nút Google chuyển tới authorization_url và nhớ trang cần quay lại", async () => {
    const assign = vi.spyOn(browser, "assign").mockImplementation(() => undefined);
    renderApp("/login?next=%2Faccount");
    await userEvent.setup().click(screen.getByRole("button", { name: /tiếp tục với google/i }));

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign.mock.calls[0]?.[0]).toMatch(/\/auth\/callback\?provider=google$/);
    expect(window.sessionStorage.getItem(NEXT_STORAGE_KEY)).toBe("/account");
    assign.mockRestore();
  });

  it("callback → refresh lấy token → về trang đã nhớ", async () => {
    setRefreshSession(DEMO_USERS.google.id);
    window.sessionStorage.setItem(NEXT_STORAGE_KEY, "/account");
    const { router } = renderApp("/auth/callback?provider=google");

    await waitFor(() => expect(router.state.location.pathname).toBe("/account"));
    expect(await screen.findByText(DEMO_USERS.google.email)).toBeTruthy();
    expect(window.sessionStorage.getItem(NEXT_STORAGE_KEY)).toBeNull();
  });

  it("callback mà không có phiên → báo lỗi và link đăng nhập lại", async () => {
    renderApp("/auth/callback?provider=google");
    expect((await screen.findByRole("alert")).textContent).toMatch(/không hoàn tất/);
    expect(screen.getByRole("link", { name: "Về trang đăng nhập" }).getAttribute("href")).toBe(
      "/login",
    );
  });

  it("callback chỉ gọi refresh một lần (refresh token xoay vòng)", async () => {
    const calls = recordRequests("/v1/auth/refresh");
    setRefreshSession(DEMO_USERS.google.id);
    const { router } = renderApp("/auth/callback?provider=google");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(calls).toHaveLength(1);
  });
});

describe("phiên và trang cần đăng nhập", () => {
  it("chưa đăng nhập mở /account → sang /login?next=/account", async () => {
    const { router } = renderApp("/account");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?next=%2Faccount");
  });

  it("tải lại trang khi còn refresh cookie → khôi phục phiên", async () => {
    setRefreshSession(DEMO_USERS.user.id);
    const { router } = renderApp("/account");
    expect(await screen.findByText(DEMO_USERS.user.email)).toBeTruthy();
    expect(router.state.location.pathname).toBe("/account");
  });

  it("đăng xuất → xóa phiên, refresh sau đó thất bại", async () => {
    setRefreshSession(DEMO_USERS.user.id);
    const { router } = renderApp("/account");
    await screen.findByText(DEMO_USERS.user.email);

    const [logoutButton] = screen.getAllByRole("button", { name: "Đăng xuất" });
    await userEvent.setup().click(logoutButton as HTMLElement);

    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    expect(useAuthStore.getState()).toMatchObject({ accessToken: null, status: "anonymous" });
    expect(state.refreshUserId).toBeNull();
    expect(screen.getAllByRole("link", { name: "Đăng nhập" }).length).toBeGreaterThan(0);
  });
});
