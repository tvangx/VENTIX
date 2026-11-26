// @vitest-environment jsdom
import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SERVICE_PREFIX } from "@/lib/api";
import { API_BASE_URL } from "@/lib/http/client";
import { mockServer } from "@/mocks/node";
import { renderApp, setupAppHarness } from "@/test/app-harness";

setupAppHarness();

// Thứ Tư 18/11/2026, 12:00 giờ Việt Nam. Chỉ giả lập Date; timer thật để MSW/React chạy bình thường.
const NOW = new Date("2026-11-18T05:00:00Z");
const SONG_AM = "30000000-0000-4000-8000-000000000001";
const GIO_MUA = "30000000-0000-4000-8000-000000000002";
const GIAO_HUONG = "30000000-0000-4000-8000-000000000003";
const NEON_PENDING = "30000000-0000-4000-8000-000000000005";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function openEvent(id: string) {
  const view = renderApp(`/events/${id}`);
  await screen.findByRole("heading", { level: 1 });
  return view;
}

function text(element: HTMLElement): string {
  return element.textContent ?? "";
}

describe("trang chi tiết sự kiện", () => {
  it("sự kiện đang mở bán có hàng chờ: thông tin, hạng vé, đợt bán, nút vào phòng chờ", async () => {
    await openEvent(SONG_AM);

    expect(text(screen.getByRole("heading", { level: 1 }))).toBe("Sóng Âm Live Concert 2026");
    const when = screen.getByText("Khi nào").parentElement as HTMLElement;
    expect(text(when)).toContain("T7 19.12.2026");
    expect(text(when)).toContain("19:00 – 22:30");
    const where = screen.getByText("Ở đâu").parentElement as HTMLElement;
    expect(text(where)).toContain("Nhà thi đấu Ánh Sao");
    expect(text(where)).toContain("Quận 10, TP. Hồ Chí Minh");

    expect(text(screen.getByRole("heading", { level: 2, name: /hạng vé/ }))).toContain(
      "Bốn hạng vé",
    );
    const classes = screen.getAllByRole("listitem").filter((li) => /ghế/.test(text(li)));
    expect(classes.map(text)).toEqual([
      "SVIP3.500.000đ500 ghế",
      "VIP2.500.000đ1.500 ghế",
      "Standard1.500.000đ4.000 ghế",
      "Economy800.000đ4.000 ghế",
    ]);

    const phases = within(
      screen.getByRole("heading", { level: 2, name: /mở bán/ }).parentElement as HTMLElement,
    )
      .getAllByRole("listitem")
      .map(text);
    expect(phases).toEqual([
      "Đợt 1 · Đã kết thúc14.11 10:00 → 15.11 10:00Phòng chờ · tối đa 2 vé · cần xác minh CCCD",
      "Đợt 2 · Đang mở16.11 10:00 → 19.12 17:00Phòng chờ · tối đa 4 vé · cần xác minh CCCD",
    ]);

    // Đợt 2 đóng lúc 19/12 10:00 UTC: còn 31 ngày 5 giờ.
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe(
      "Đợt bán đóng sau 31 ngày 5 giờ 0 phút",
    );
    expect(screen.getByText(/Tối đa/).textContent).toBe("Tối đa4 vé");

    const cta = screen.getByRole("link", { name: "Vào phòng chờ" });
    expect(cta.getAttribute("href")).toBe(`/events/${SONG_AM}/buy`);
    expect(text(cta.parentElement as HTMLElement)).toContain("Từ 800.000đ");
  });

  it("sự kiện chưa mở bán: đếm ngược tới giờ mở bán, nút bị tắt", async () => {
    await openEvent(GIAO_HUONG);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe(
      "Mở bán sau 12 ngày 22 giờ 0 phút",
    );
    const cta = screen.getByRole("button", { name: "Mở bán 01.12" });
    expect((cta as HTMLButtonElement).disabled).toBe(true);
    expect(text(screen.getByRole("heading", { level: 2, name: /hạng vé/ }))).toContain(
      "Ba hạng vé",
    );
  });

  it("vé đứng không chọn ghế: nút Mua vé, không có câu “một sơ đồ”", async () => {
    await openEvent(GIO_MUA);
    expect(screen.getByRole("link", { name: "Mua vé" })).toBeTruthy();
    expect(text(screen.getByRole("heading", { level: 2, name: /hạng vé/ }))).toBe("Hai hạng vé");
    expect(screen.getAllByText(/vé đứng/)).toHaveLength(2);
  });

  it("nút mua vé yêu cầu đăng nhập và giữ đường quay lại checkout", async () => {
    const { router } = await openEvent(SONG_AM);
    await userEvent.setup().click(screen.getByRole("link", { name: "Vào phòng chờ" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe(
      `/events/${SONG_AM}/buy`,
    );
  });

  it("sự kiện chưa công khai → không tìm thấy, không có nút thử lại", async () => {
    await openEvent(NEON_PENDING);
    expect(text(screen.getByRole("heading", { level: 1 }))).toContain("Không tìm thấy");
    expect(text(screen.getByRole("alert"))).toContain("chưa được công khai");
    expect(screen.queryByRole("button", { name: "Thử lại" })).toBeNull();
    expect(screen.getByRole("link", { name: "Xem sự kiện khác" }).getAttribute("href")).toBe(
      "/explore",
    );
  });

  it("lỗi máy chủ → thử lại được", async () => {
    let fail = true;
    mockServer.use(
      http.get(`*${API_BASE_URL}${SERVICE_PREFIX.event}/v1/events/:id`, () =>
        fail ? HttpResponse.json({ message: "down" }, { status: 503 }) : undefined,
      ),
    );
    renderApp(`/events/${SONG_AM}`);
    expect(text(await screen.findByRole("alert", {}, { timeout: 4000 }))).toContain(
      "chưa tải được thông tin sự kiện",
    );
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Thử lại" }));
    expect(text(await screen.findByRole("heading", { level: 1, name: /Sóng Âm/ }))).toBe(
      "Sóng Âm Live Concert 2026",
    );
  });
});
