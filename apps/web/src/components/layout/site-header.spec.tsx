// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useAuthStore } from "@/lib/http/auth-store";
import { renderApp, setupAppHarness } from "@/test/app-harness";

setupAppHarness();

function menuButton() {
  return screen.getByRole("button", { name: /mở menu|đóng menu/i });
}

describe("header", () => {
  it("menu mobile: mở/đóng bằng nút, Escape và khi đổi trang", async () => {
    const { router } = renderApp("/");
    const user = userEvent.setup();
    await waitFor(() => expect(useAuthStore.getState().status).toBe("anonymous"));

    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    await user.click(menuButton());
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    expect(menuButton().getAttribute("aria-label")).toBe("Đóng menu");

    await user.keyboard("{Escape}");
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");

    await user.click(menuButton());
    const mobileNav = screen.getByRole("navigation", { name: "Chính (mobile)" });
    await user.click(within(mobileNav).getByRole("link", { name: "Sàn bán lại" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/resale"));
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("link Đăng nhập mang theo trang hiện tại", async () => {
    renderApp("/explore");
    await waitFor(() => expect(useAuthStore.getState().status).toBe("anonymous"));
    const links = screen.getAllByRole("link", { name: "Đăng nhập" });
    expect(links.map((link) => link.getAttribute("href"))).toContain("/login?next=%2Fexplore");
  });

  it("nút theme đánh dấu lựa chọn hiện tại bằng aria-pressed", async () => {
    renderApp("/");
    const user = userEvent.setup();
    const [group] = screen.getAllByRole("group", { name: "Giao diện" });
    const dark = within(group as HTMLElement).getByRole("button", { name: "Tối" });
    await user.click(dark);
    expect(dark.getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
