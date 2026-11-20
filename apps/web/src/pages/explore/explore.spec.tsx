// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
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
const EVENTS_URL = `*${API_BASE_URL}${SERVICE_PREFIX.event}/v1/events`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

/** Tiêu đề các thẻ theo thứ tự hiển thị. */
async function shownTitles(): Promise<string[]> {
  const list = await screen.findByTestId("catalog-results");
  return within(list)
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent ?? "");
}

function recordCatalogRequests() {
  const seen: URL[] = [];
  mockServer.events.on("request:start", ({ request }) => {
    const url = new URL(request.url);
    // Bỏ qua request test tự gửi lại kèm limit (xem test "Xem thêm"); UI không gửi limit.
    if (url.pathname.endsWith("/event/v1/events") && !url.searchParams.has("limit")) seen.push(url);
  });
  return seen;
}

describe("trang Khám phá", () => {
  it("hiện đủ sự kiện đã công khai của seed, sắp theo ngày diễn", async () => {
    renderApp("/explore");
    expect(await shownTitles()).toEqual([
      "Kịch: Chuyến Tàu Đêm",
      "Sóng Âm Live Concert 2026",
      "Lễ hội Âm nhạc Gió Mùa 2027",
      "Hòa nhạc Giao hưởng Mùa Xuân",
    ]);
    expect(screen.queryByText("Neon Pulse EDM Night 2027")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("4 đêm khớp bộ lọc");
    const card = screen.getByRole("link", { name: /Sóng Âm Live Concert 2026/ });
    expect(card.getAttribute("href")).toBe("/events/30000000-0000-4000-8000-000000000001");
    expect(card.textContent).toContain("T7 19.12 · 19:00");
    expect(card.textContent).toContain("từ 800.000đ");
    expect(card.textContent).toContain("Đang mở bán · có hàng chờ");
    expect(within(card).getByRole("presentation").getAttribute("src")).toBe(
      "/seed/banners/song-am-live-2026.jpg",
    );
  });

  it("tìm kiếm ghi từ khóa lên URL và lọc theo địa điểm", async () => {
    const { router } = renderApp("/explore");
    await shownTitles();
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox"), "hà nội");
    await user.click(screen.getByRole("button", { name: "Tìm" }));

    await waitFor(() => expect(router.state.location.search).toBe("?q=h%C3%A0+n%E1%BB%99i"));
    await waitFor(async () =>
      expect(await shownTitles()).toEqual(["Kịch: Chuyến Tàu Đêm", "Hòa nhạc Giao hưởng Mùa Xuân"]),
    );
    expect(screen.getByRole("status").textContent).toContain("2 đêm khớp “hà nội”");
  });

  it("lọc tình trạng và mức giá, đổi sắp xếp", async () => {
    const { router } = renderApp("/explore");
    await shownTitles();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /Tình trạng/ }));
    await user.click(screen.getByRole("button", { name: "Sắp mở bán" }));
    await waitFor(async () =>
      expect(await shownTitles()).toEqual(["Hòa nhạc Giao hưởng Mùa Xuân"]),
    );
    expect(router.state.location.search).toBe("?status=UPCOMING");
    expect(screen.getByRole("button", { name: "Sắp mở bán" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Sắp mở bán" }));
    await user.click(screen.getByRole("button", { name: /Giá vé/ }));
    await user.click(screen.getByRole("button", { name: "300k đến 1 triệu" }));
    await user.selectOptions(screen.getByLabelText("Sắp xếp"), "price_asc");

    await waitFor(async () =>
      expect(await shownTitles()).toEqual([
        "Kịch: Chuyến Tàu Đêm",
        "Hòa nhạc Giao hưởng Mùa Xuân",
        "Sóng Âm Live Concert 2026",
      ]),
    );
    expect(router.state.location.search).toBe("?price=300k-1m&sort=price_asc");
  });

  it("đọc bộ lọc từ URL và gửi khoảng ngày theo giờ Việt Nam", async () => {
    const requests = recordCatalogRequests();
    renderApp("/explore?date=range&from=2026-12-01&to=2026-12-31");
    expect(await shownTitles()).toEqual(["Kịch: Chuyến Tàu Đêm", "Sóng Âm Live Concert 2026"]);
    expect(screen.getByRole("button", { name: /Ngày/ }).textContent).toContain("01.12 – 31.12");
    const last = requests[requests.length - 1];
    expect(last?.searchParams.get("start_from")).toBe("2026-12-01T00:00:00+07:00");
    expect(last?.searchParams.get("start_before")).toBe("2027-01-01T00:00:00+07:00");
  });

  it("không có kết quả → gợi ý xóa bộ lọc", async () => {
    const { router } = renderApp("/explore?price=under-300k");
    expect(await screen.findByText(/Chưa có đêm nào khớp/)).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(await shownTitles()).toHaveLength(4);
  });

  it("“Xem thêm” tải trang sau bằng next_cursor", async () => {
    const requests = recordCatalogRequests();
    // Thu nhỏ trang còn 2 sự kiện để có trang thứ hai (UI không gửi limit, backend mặc định 20).
    mockServer.use(
      http.get(EVENTS_URL, async ({ request }) => {
        const url = new URL(request.url);
        // Request đã có limit (do chính handler này gửi lại) thì để handler mock gốc trả lời.
        if (url.searchParams.has("limit")) return undefined;
        url.searchParams.set("limit", "2");
        const response = await fetch(new Request(url, { headers: request.headers }));
        return HttpResponse.json(await response.json());
      }),
    );
    renderApp("/explore");
    expect(await shownTitles()).toEqual(["Kịch: Chuyến Tàu Đêm", "Sóng Âm Live Concert 2026"]);
    expect(screen.getByRole("status").textContent).toContain("2+ đêm");

    await userEvent.setup().click(screen.getByRole("button", { name: "Xem thêm" }));
    await waitFor(async () => expect(await shownTitles()).toHaveLength(4));
    expect(screen.queryByRole("button", { name: "Xem thêm" })).toBeNull();
    expect(requests.map((url) => url.searchParams.get("cursor"))).toEqual([
      null,
      "start_at|30000000-0000-4000-8000-000000000001|2026-12-19T12:00:00.000000Z",
    ]);
  });

  it("lỗi API → thông báo lỗi và thử lại được", async () => {
    let fail = true;
    mockServer.use(
      http.get(EVENTS_URL, () =>
        fail ? HttpResponse.json({ message: "down" }, { status: 503 }) : undefined,
      ),
    );
    renderApp("/explore");
    expect((await screen.findByRole("alert", {}, { timeout: 4000 })).textContent).toContain(
      "chưa tải được danh sách sự kiện",
    );
    fail = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Thử lại" }));
    expect(await shownTitles()).toHaveLength(4);
  });

  it("bấm thẻ mở trang chi tiết", async () => {
    const { router } = renderApp("/explore");
    await shownTitles();
    await userEvent.setup().click(screen.getByRole("link", { name: /Kịch: Chuyến Tàu Đêm/ }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/events/30000000-0000-4000-8000-000000000004"),
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Kịch: Chuyến Tàu Đêm" }),
    ).toBeTruthy();
  });
});
