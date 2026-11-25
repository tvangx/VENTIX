// @vitest-environment jsdom
import { forwardRef } from "react";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderApp, setupAppHarness } from "@/test/app-harness";

// jsdom không có canvas nên Konva không chạy được: thay canvas bằng bản giả giữ nguyên props.
// Bấm ghế trên canvas thật đã kiểm trên Chrome (run report V-202, mục 5).
vi.mock("@/components/seat-map/seat-map-canvas", () => ({
  SeatMapCanvas: forwardRef<
    unknown,
    { label: string; selected: ReadonlySet<string>; onSeatPress: (key: string) => void }
  >(function FakeCanvas({ label, selected, onSeatPress }, _ref) {
    return (
      <div role="img" aria-label={label}>
        <button type="button" onClick={() => onSeatPress("0:0:1:3")}>
          giả lập bấm ghế B3
        </button>
        <span data-testid="canvas-selected">{[...selected].join(",")}</span>
      </div>
    );
  }),
}));

setupAppHarness();

// Thứ Tư 18/11/2026, 12:00 giờ Việt Nam.
const NOW = new Date("2026-11-18T05:00:00Z");
const SONG_AM = "30000000-0000-4000-8000-000000000001"; // 10.000 ghế, giới hạn 4
const GIO_MUA = "30000000-0000-4000-8000-000000000002"; // vé đứng
const GIAO_HUONG = "30000000-0000-4000-8000-000000000003"; // sắp mở bán
const KICH = "30000000-0000-4000-8000-000000000004"; // đang mở, không hàng chờ

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

async function openSeats(id: string) {
  const view = renderApp(`/events/${id}/seats`);
  await screen.findByRole("heading", { level: 1 });
  return view;
}

function text(element: HTMLElement | null): string {
  return element?.textContent ?? "";
}

async function pickSeat(
  user: ReturnType<typeof userEvent.setup>,
  block: string,
  row: string,
  seat: string,
) {
  await user.selectOptions(
    screen.getByLabelText("Block · khu"),
    screen.getByRole("option", { name: block }),
  );
  await user.selectOptions(screen.getByLabelText("Hàng"), row);
  await user.selectOptions(screen.getByLabelText("Ghế số"), seat);
  await user.click(screen.getByRole("button", { name: "Chọn ghế này" }));
}

describe("trang chọn ghế", () => {
  it("sơ đồ 10.000 ghế: block, chú thích hạng vé, giới hạn của đợt bán", async () => {
    await openSeats(SONG_AM);
    expect(text(screen.getByRole("heading", { level: 1 }))).toBe("Chọn chỗ ngồi");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "Sơ đồ 10.000 ghế, 4 block",
    );
    const zones = within(screen.getByRole("group", { name: "Block" })).getAllByRole("button");
    expect(zones.map(text)).toEqual([
      "Block A · SVIP",
      "Block B · VIP",
      "Block C · Standard",
      "Block D · Economy",
    ]);
    const legend = within(screen.getByRole("list", { name: "Chú thích" })).getAllByRole("listitem");
    expect(legend.map(text)).toEqual([
      "SVIP · 3.500.000đ",
      "VIP · 2.500.000đ",
      "Standard · 1.500.000đ",
      "Economy · 800.000đ",
      "Bạn chọn",
      "Người khác đang giữ",
      "Đã bán",
    ]);
    expect(text(screen.getByRole("region", { name: "Ghế của bạn" }))).toContain("0 / 4 ghế");
  });

  it("chọn bằng bàn phím: danh sách ghế, tạm tính, bỏ chọn", async () => {
    await openSeats(SONG_AM);
    const user = userEvent.setup();
    await pickSeat(user, "Block A · Khu A1", "A", "1");
    await pickSeat(user, "Block B · Khu B2", "C", "7");

    const list = screen.getByRole("list", { name: "Ghế đã chọn" });
    expect(within(list).getAllByRole("listitem").map(text)).toEqual([
      "A1 SVIP · Block A · Khu A13.500.000đ",
      "C7 VIP · Block B · Khu B22.500.000đ",
    ]);
    expect(text(screen.getByTestId("seat-total"))).toBe("6.000.000đ");
    expect(text(screen.getByRole("region", { name: "Ghế của bạn" }))).toContain("2 / 4 ghế");
    // Canvas nhận đúng tập ghế đang chọn để tô màu.
    expect(text(screen.getByTestId("canvas-selected"))).toBe("0:0:0:1,1:1:2:7");

    await user.click(screen.getByRole("button", { name: "Bỏ ghế A1" }));
    expect(text(screen.getByTestId("seat-total"))).toBe("2.500.000đ");
    expect(text(screen.getByTestId("canvas-selected"))).toBe("1:1:2:7");
  });

  it("bấm ghế trên sơ đồ: chọn rồi bấm lần nữa để bỏ", async () => {
    await openSeats(SONG_AM);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "giả lập bấm ghế B3" }));
    expect(text(screen.getByRole("list", { name: "Ghế đã chọn" }))).toContain(
      "B3 SVIP · Block A · Khu A1",
    );
    await user.click(screen.getByRole("button", { name: "giả lập bấm ghế B3" }));
    expect(screen.queryByRole("list", { name: "Ghế đã chọn" })).toBeNull();
  });

  it("không vượt giới hạn 4 ghế; chọn lại ghế đã chọn bằng bàn phím thì báo, không bỏ", async () => {
    await openSeats(SONG_AM);
    const user = userEvent.setup();
    for (const seat of ["1", "2", "3", "4"]) await pickSeat(user, "Block A · Khu A1", "A", seat);
    await pickSeat(user, "Block A · Khu A1", "A", "5");
    expect(text(screen.getByRole("status"))).toBe("Bạn đã chọn đủ số ghế tối đa của đợt mở bán.");
    expect(
      within(screen.getByRole("list", { name: "Ghế đã chọn" })).getAllByRole("listitem"),
    ).toHaveLength(4);

    await pickSeat(user, "Block A · Khu A1", "A", "2");
    expect(text(screen.getByRole("status"))).toBe("Bạn đã chọn ghế này rồi.");
    expect(
      within(screen.getByRole("list", { name: "Ghế đã chọn" })).getAllByRole("listitem"),
    ).toHaveLength(4);
  });

  it("nút tiếp tục thanh toán còn tắt (giữ ghế là V-301)", async () => {
    await openSeats(KICH);
    const button = screen.getByRole("link", { name: "Tiếp tục giữ ghế" });
    expect(button.getAttribute("href")).toContain("/buy");
    expect(text(screen.getByRole("region", { name: "Ghế của bạn" }))).toContain("0 / 6 ghế");
  });

  it("sự kiện chưa mở bán: xem được sơ đồ nhưng chưa chọn được", async () => {
    await openSeats(GIAO_HUONG);
    expect(text(screen.getByRole("region", { name: "Ghế của bạn" }))).toContain("Chưa mở bán");
    expect(
      (screen.getByRole("button", { name: "Chọn ghế này" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await userEvent.setup().click(screen.getByRole("button", { name: "giả lập bấm ghế B3" }));
    expect(text(screen.getByRole("status"))).toContain("chưa chọn ghế được");
  });

  it("vé đứng: không cần chọn ghế", async () => {
    await openSeats(GIO_MUA);
    expect(text(screen.getByRole("alert"))).toBe("Sự kiện này bán vé đứng, không cần chọn ghế.");
    expect(screen.getByRole("link", { name: "Về trang sự kiện" }).getAttribute("href")).toBe(
      `/events/${GIO_MUA}`,
    );
  });
});

describe("đường vào trang chọn ghế từ trang chi tiết", () => {
  it("nút Chọn ghế và link Xem sơ đồ ghế", async () => {
    const { router } = renderApp(`/events/${KICH}`);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.getByRole("link", { name: "Xem sơ đồ ghế" }).getAttribute("href")).toBe(
      `/events/${KICH}/seats`,
    );
    await userEvent.setup().click(screen.getByRole("link", { name: "Chọn ghế" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/events/${KICH}/seats`));
    expect(text(await screen.findByRole("heading", { level: 1, name: /Chọn/ }))).toBe(
      "Chọn chỗ ngồi",
    );
  });
});
