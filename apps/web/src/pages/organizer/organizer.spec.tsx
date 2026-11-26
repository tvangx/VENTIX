// @vitest-environment jsdom
import { forwardRef } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_ORGANIZER_ID, DEMO_USERS, setRefreshSession, state } from "@/mocks/db";
import type { MockOrgEvent } from "@/mocks/organizer-store";
import { renderApp, setupAppHarness } from "@/test/app-harness";

// jsdom không có canvas: thay sơ đồ Konva (xem trước ở bước Sơ đồ ghế) bằng bản giả giữ nhãn.
vi.mock("@/components/seat-map/seat-map-canvas", () => ({
  SeatMapCanvas: forwardRef<unknown, { label: string }>(function FakeCanvas({ label }, _ref) {
    return <div role="img" aria-label={label} />;
  }),
}));

setupAppHarness();

/** Tệp PNG giả đủ byte đầu (magic bytes) để qua bước confirm của event-service. */
function pngFile(size: number): File {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  return new File([bytes], "banner.png", { type: "image/png" });
}

// jsdom không có object URL (xem trước ảnh banner).
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
beforeAll(() => {
  URL.createObjectURL = () => "blob:banner-preview";
  URL.revokeObjectURL = () => undefined;
});
afterAll(() => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

const VENUE = "20000000-0000-4000-8000-000000000001"; // Nhà thi đấu Ánh Sao, 12.000 chỗ

function seedDraft(over: Partial<MockOrgEvent> = {}): MockOrgEvent {
  const event: MockOrgEvent = {
    id: "33000000-0000-4000-8000-000000000001",
    organizer_id: DEMO_ORGANIZER_ID,
    status: "DRAFT",
    venue_id: VENUE,
    title: "Neon Pulse 2027",
    description: "",
    banner_key: null,
    start_at: "2027-03-13T13:00:00.000Z",
    end_at: "2027-03-13T16:00:00.000Z",
    version: 0,
    created_at: "2026-11-20T00:00:00.000Z",
    updated_at: "2026-11-20T00:00:00.000Z",
    ...over,
  };
  state.organizer.events.set(event.id, event);
  return event;
}

function asOrganizer(path: string) {
  setRefreshSession(DEMO_USERS.organizer.id);
  return renderApp(path);
}

function text(element: HTMLElement | null): string {
  return element?.textContent ?? "";
}

/** Ô datetime-local: jsdom không gõ được từng ký tự nên đặt giá trị trực tiếp. */
function setTime(label: string | RegExp, value: string, scope: HTMLElement = document.body) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
}

async function addClass(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  kind: "Vé đứng (GA)" | "Có chỗ ngồi",
  price: string,
  capacity: string,
) {
  const row = await screen.findByRole("group", { name: "Hạng vé mới" });
  await user.type(within(row).getByLabelText("Tên hạng"), name);
  await user.selectOptions(within(row).getByLabelText("Loại"), kind);
  await user.type(within(row).getByLabelText("Giá (VND)"), price);
  await user.type(within(row).getByLabelText("Số lượng"), capacity);
  await user.click(within(row).getByRole("button", { name: "Lưu hạng vé" }));
  await screen.findByRole("group", { name: `Hạng ${name}` });
}

describe("hậu trường ban tổ chức", () => {
  it("tài khoản không thuộc ban tổ chức nào thì không vào được", async () => {
    setRefreshSession(DEMO_USERS.user.id);
    renderApp("/organizer/events");
    expect(
      text(await screen.findByRole("heading", { level: 1, name: "Chưa là ban tổ chức" })),
    ).toBe("Chưa là ban tổ chức");
  });

  it("chưa đăng nhập → sang trang đăng nhập rồi quay lại", async () => {
    const { router } = renderApp("/organizer/events");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?next=%2Forganizer%2Fevents");
  });
});

describe("wizard tạo sự kiện", () => {
  it("đủ các bước: thông tin → hạng vé → sơ đồ → đợt bán → banner → gửi duyệt", async () => {
    const user = userEvent.setup();
    const { router } = asOrganizer("/organizer/events");
    expect(text(await screen.findByText(/Chưa có sự kiện nào/))).toContain("Tạo sự kiện");
    await user.click(screen.getByRole("link", { name: "+ Tạo sự kiện" }));

    // 1. Thông tin: lỗi tại ô khi thiếu, rồi lưu.
    await user.click(await screen.findByRole("button", { name: "Lưu và tiếp: Hạng vé →" }));
    expect(text(await screen.findByText("Nhập tên sự kiện"))).toBe("Nhập tên sự kiện");
    expect(state.organizer.events.size).toBe(0);
    await user.type(screen.getByLabelText("Tên sự kiện"), "Neon Pulse 2027");
    await user.type(screen.getByLabelText("Mô tả"), "Đêm EDM");
    setTime("Bắt đầu", "2027-03-13T20:00");
    setTime("Kết thúc", "2027-03-13T23:00");
    await user.selectOptions(screen.getByLabelText("Địa điểm"), "Nhà thi đấu Ánh Sao");
    await user.click(screen.getByRole("button", { name: "Lưu và tiếp: Hạng vé →" }));

    await screen.findByRole("heading", { level: 2, name: "Hạng vé" });
    const [created] = [...state.organizer.events.values()];
    expect(created).toMatchObject({
      title: "Neon Pulse 2027",
      status: "DRAFT",
      venue_id: VENUE,
      start_at: "2027-03-13T13:00:00.000Z", // 20:00 giờ Việt Nam
    });
    expect(router.state.location.pathname).toBe(`/organizer/events/${created?.id}`);
    expect(router.state.location.search).toBe("?step=classes");

    // 2. Hạng vé: một hạng có ghế, một hạng đứng.
    await addClass(user, "VIP", "Có chỗ ngồi", "2.000.000", "60");
    await user.click(screen.getByRole("button", { name: "+ Thêm hạng vé" }));
    await addClass(user, "Standing", "Vé đứng (GA)", "500.000", "100");
    expect(text(screen.getByText(/^Tổng /))).toBe("Tổng 160 / 12.000 chỗ");
    const steps = within(screen.getByRole("list", { name: "Các bước" }));
    expect(steps.getAllByRole("button").map(text)).toEqual([
      "1. Thông tinđã xong ✓",
      "2. Hạng véđang thực hiện",
      "3. Sơ đồchưa thiết lập",
      "4. Đợt mở bánchưa thiết lập",
      "5. Bannerchưa thiết lập",
      "6. Gửi duyệtchưa thiết lập",
    ]);
    await user.click(screen.getByRole("button", { name: "Tiếp →" }));

    // 3. Sơ đồ: gợi ý sẵn đúng 60 ghế cho Block A; khu đứng của Standing lấy tên hạng, đổi tên cho
    // rõ vị trí; lưu thành phiên bản 1.
    await screen.findByRole("heading", { level: 2, name: "Sơ đồ" });
    const gaName = screen.getByLabelText(/^Khu đứng của hạng Standing/);
    expect((gaName as HTMLInputElement).value).toBe("Standing");
    await user.clear(gaName);
    await user.type(gaName, "Khu đứng A – sát sân khấu");
    const blockA = screen.getByRole("group", { name: "Block A" });
    expect(text(blockA)).toContain("1 khu · 60 ghế");
    expect(text(screen.getByTestId("seat-totals"))).toBe("Tổng 60 ghế · VIP 60/60");
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Xem trước sơ đồ: 60 ghế, 1 block; khu đứng Khu đứng A – sát sân khấu.",
    );
    expect(screen.getByRole("button", { name: "Tiếp →" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Lưu sơ đồ" }));
    expect(text(await screen.findByText("Đã lưu sơ đồ phiên bản 1."))).toBe(
      "Đã lưu sơ đồ phiên bản 1.",
    );
    const [map] = [...state.organizer.seatMaps.values()];
    const standing = [...state.organizer.ticketClasses.values()].find((c) => c.kind === "GA");
    expect(map?.layout).toMatchObject({
      zones: [{ name: "Block A", blocks: [{ name: "A1" }] }],
      ga_areas: [{ name: "Khu đứng A – sát sân khấu", ticket_class_id: standing?.id }],
    });
    await user.click(screen.getByRole("button", { name: "Tiếp →" }));

    // 4. Đợt mở bán: phải kết thúc trước giờ diễn.
    await screen.findByRole("heading", { level: 2, name: "Đợt mở bán" });
    const phase = screen.getByRole("group", { name: "Đợt mới" });
    setTime("Mở bán", "2027-03-01T10:00", phase);
    setTime("Đóng bán", "2027-03-13T21:00", phase);
    await user.click(within(phase).getByRole("button", { name: "Lưu đợt mới" }));
    expect(text(within(phase).getByText("Đợt bán phải kết thúc trước giờ diễn"))).toBeTruthy();
    setTime("Đóng bán", "2027-03-13T19:00", phase);
    await user.click(within(phase).getByRole("button", { name: "Lưu đợt mới" }));
    await screen.findByRole("group", { name: "Đợt 1" });
    expect([...state.organizer.salePhases.values()][0]).toMatchObject({
      starts_at: "2027-03-01T03:00:00.000Z",
      ends_at: "2027-03-13T12:00:00.000Z",
      per_user_limit: 4,
    });
    await user.click(screen.getByRole("button", { name: "Tiếp: Banner →" }));

    // 5. Banner: presign → PUT vào staging → confirm gắn banner_key `public/events/...`.
    await screen.findByRole("heading", { level: 2, name: "Banner" });
    const versionBefore = state.organizer.events.get(created?.id ?? "")?.version ?? -1;
    await user.upload(screen.getByLabelText("Chọn ảnh banner"), pngFile(2048));
    await user.click(screen.getByRole("button", { name: "Tải ảnh lên" }));
    await screen.findByText("Sự kiện đã có banner.");
    const saved = state.organizer.events.get(created?.id ?? "");
    expect(saved?.banner_key).toMatch(
      new RegExp(`^public/events/${created?.id}/[0-9a-f-]{36}\\.webp$`),
    );
    expect(saved?.version).toBe(versionBefore + 1);
    expect(state.organizer.bannerPublic.get(saved?.banner_key ?? "")?.bytes.length).toBe(2048);
    expect(state.organizer.bannerStaging.size).toBe(0);
    await user.click(screen.getByRole("button", { name: "Tiếp: Gửi duyệt →" }));

    // 6. Gửi duyệt → Chờ duyệt, wizard chỉ còn xem.
    await screen.findByRole("heading", { level: 2, name: "Gửi duyệt" });
    await user.click(screen.getByRole("button", { name: "Gửi duyệt" }));
    expect(text(await screen.findByText(/^Đã gửi\./))).toBe("Đã gửi. Trạng thái: Chờ duyệt.");
    expect(state.organizer.events.get(created?.id ?? "")?.status).toBe("PENDING");
    expect(screen.queryByRole("button", { name: "Gửi duyệt" })).toBeNull();
  }, 30_000);

  it("sơ đồ ghế tự do: hàng khác số ghế, khu có hai hạng, khu không đều, tên tự đặt", async () => {
    const event = seedDraft();
    const ticket = (id: string, name: string, capacity: number) => ({
      id,
      event_id: event.id,
      name,
      kind: "SEATED" as const,
      price_vnd: 1_000_000,
      capacity,
      version: 0,
      created_at: event.created_at,
      updated_at: event.created_at,
    });
    const VIP = "31000000-0000-4000-8000-0000000000d1";
    const STD = "31000000-0000-4000-8000-0000000000d2";
    state.organizer.ticketClasses.set(VIP, ticket(VIP, "VIP", 30));
    state.organizer.ticketClasses.set(STD, ticket(STD, "Standard", 20));
    const user = userEvent.setup();
    asOrganizer(`/organizer/events/${event.id}?step=seatmap`);

    // Bản tạo nhanh: Block A (VIP, khu A1: 2 hàng × 15), Block B (Standard, khu B1: 1 hàng × 20).
    const blockA = await screen.findByRole("group", { name: "Block A" });
    const retype = async (el: HTMLElement, value: string) => {
      await user.clear(el);
      await user.type(el, value);
    };
    await retype(within(blockA).getByLabelText("Tên block"), "Tầng trệt");
    const t = () => screen.getByRole("group", { name: "Tầng trệt" });
    await retype(within(t()).getByLabelText("Tên khu"), "T1");
    const t1 = () => screen.getByRole("group", { name: "Khu T1" });

    // Hàng khác số ghế; thêm hàng C thuộc Standard trong cùng khu.
    await retype(within(t1()).getByLabelText("Số ghế hàng A"), "10");
    await retype(within(t1()).getByLabelText("Số ghế hàng B"), "20");
    await user.click(within(t1()).getByRole("button", { name: "+ Thêm hàng vào khu T1" }));
    await retype(within(t1()).getByLabelText("Số ghế hàng C"), "5");
    await user.selectOptions(within(t1()).getByLabelText("Hạng vé hàng C"), "Standard");

    // Khu thứ hai chỉ có một hàng; tên trùng thì báo lỗi.
    await user.click(within(t()).getByRole("button", { name: "+ Thêm khu vào Tầng trệt" }));
    const khu2 = within(t()).getByRole("group", { name: "Khu Tầng trệt1" });
    await retype(within(khu2).getByLabelText("Tên khu"), "T1");
    expect(text(t())).toContain("Trùng tên khu “T1” trong block");
    expect(screen.getByRole("button", { name: "Lưu sơ đồ" })).toHaveProperty("disabled", true);
    const [, second] = within(t()).getAllByRole("group", { name: "Khu T1" });
    if (!second) throw new Error("thiếu khu thứ hai");
    await retype(within(second).getByLabelText("Tên khu"), "T2");
    const t2 = () => screen.getByRole("group", { name: "Khu T2" });
    await user.click(within(t2()).getByRole("button", { name: "Xóa hàng C" }));
    await user.click(within(t2()).getByRole("button", { name: "Xóa hàng B" }));
    await retype(within(t2()).getByLabelText("Số ghế hàng A"), "15");
    await user.selectOptions(within(t2()).getByLabelText("Hạng vé hàng A"), "Standard");

    // Bỏ Block B: Standard giờ nằm ở T1 (5) và T2 (15).
    await user.click(screen.getByRole("button", { name: "Xóa Block B" }));
    expect(text(screen.getByTestId("seat-totals"))).toBe(
      "Tổng 50 ghế · VIP 30/30 · Standard 20/20",
    );
    await user.click(screen.getByRole("button", { name: "Lưu sơ đồ" }));
    await screen.findByText("Đã lưu sơ đồ phiên bản 1.");
    const [map] = [...state.organizer.seatMaps.values()];
    expect(map?.layout).toEqual({
      zones: [
        {
          name: "Tầng trệt",
          blocks: [
            {
              name: "T1",
              rows: [
                { label: "A", seats: 10, ticket_class_id: VIP },
                { label: "B", seats: 20, ticket_class_id: VIP },
                { label: "C", seats: 5, ticket_class_id: STD },
              ],
            },
            { name: "T2", rows: [{ label: "A", seats: 15, ticket_class_id: STD }] },
          ],
        },
      ],
    });
    expect(screen.getByRole("button", { name: "Tiếp →" })).toHaveProperty("disabled", false);
  }, 30_000);

  it("đổi thứ tự block và khu đứng bằng nút ↑↓, lưu đúng thứ tự (= vị trí trên sơ đồ)", async () => {
    const event = seedDraft();
    const ticket = (id: string, name: string, kind: "SEATED" | "GA", capacity: number) => ({
      id,
      event_id: event.id,
      name,
      kind,
      price_vnd: 1_000_000,
      capacity,
      version: 0,
      created_at: event.created_at,
      updated_at: event.created_at,
    });
    const VIP = "31000000-0000-4000-8000-0000000000e1";
    const STD = "31000000-0000-4000-8000-0000000000e2";
    const PIT = "31000000-0000-4000-8000-0000000000e3";
    const FAN = "31000000-0000-4000-8000-0000000000e4";
    state.organizer.ticketClasses.set(VIP, ticket(VIP, "VIP", "SEATED", 30));
    state.organizer.ticketClasses.set(STD, ticket(STD, "Standard", "SEATED", 20));
    state.organizer.ticketClasses.set(PIT, ticket(PIT, "Pit", "GA", 100));
    state.organizer.ticketClasses.set(FAN, ticket(FAN, "Fanzone", "GA", 200));
    const user = userEvent.setup();
    asOrganizer(`/organizer/events/${event.id}?step=seatmap`);

    await screen.findByRole("group", { name: "Block A" });
    // Phần tử đầu không lên được nữa, phần tử cuối không xuống được nữa.
    expect(
      screen.getByRole("button", { name: "Đưa Block A lên trước (gần sân khấu hơn)" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Đưa khu đứng Fanzone sang phải" })).toHaveProperty(
      "disabled",
      true,
    );

    await user.click(
      screen.getByRole("button", { name: "Đưa Block B lên trước (gần sân khấu hơn)" }),
    );
    await user.click(screen.getByRole("button", { name: "Đưa khu đứng Fanzone sang trái" }));
    const blocks = screen.getByRole("list", { name: "Các block" });
    expect(
      within(blocks)
        .getAllByLabelText("Tên block")
        .map((el) => (el as HTMLInputElement).value),
    ).toEqual(["Block B", "Block A"]);

    await user.click(screen.getByRole("button", { name: "Lưu sơ đồ" }));
    await screen.findByText("Đã lưu sơ đồ phiên bản 1.");
    const [map] = [...state.organizer.seatMaps.values()];
    const layout = map?.layout as {
      zones: { name: string }[];
      ga_areas: { name: string; ticket_class_id: string }[];
    };
    expect(layout.zones.map((z) => z.name)).toEqual(["Block B", "Block A"]);
    expect(layout.ga_areas).toEqual([
      { name: "Fanzone", ticket_class_id: FAN },
      { name: "Pit", ticket_class_id: PIT },
    ]);
  }, 30_000);

  it("đủ hạng vé và đợt bán nhưng hạng có ghế chưa có sơ đồ → không gửi duyệt được", async () => {
    const event = seedDraft();
    state.organizer.ticketClasses.set("c1", {
      id: "31000000-0000-4000-8000-0000000000c1",
      event_id: event.id,
      name: "VIP",
      kind: "SEATED",
      price_vnd: 1_000_000,
      capacity: 40,
      version: 0,
      created_at: event.created_at,
      updated_at: event.created_at,
    });
    state.organizer.salePhases.set("p1", {
      id: "32000000-0000-4000-8000-0000000000a1",
      event_id: event.id,
      starts_at: "2027-03-01T03:00:00.000Z",
      ends_at: "2027-03-13T12:00:00.000Z",
      queue_enabled: false,
      admit_rate: 200,
      per_user_limit: 4,
      require_kyc: false,
      version: 0,
      created_at: event.created_at,
      updated_at: event.created_at,
    });
    asOrganizer(`/organizer/events/${event.id}?step=review`);
    const checks = await screen.findByRole("list", { name: "Kiểm tra trước khi gửi" });
    expect(within(checks).getAllByRole("listitem").map(text)).toEqual([
      "Xong:Thông tinNeon Pulse 2027 · T7 13.03.2027 · 20:00",
      "Xong:Hạng véVIP 1.000.000đ",
      "Còn thiếu:Sơ đồChưa có sơ đồ đủ ghế khớp hạng véSửa sơ đồ",
      "Xong:Đợt mở bán1 đợt",
      "Không bắt buộc:BannerChưa có banner (không bắt buộc)Sửa banner",
    ]);
    expect(screen.getByRole("button", { name: "Gửi duyệt" })).toHaveProperty("disabled", true);
  });

  it("chỉ có vé đứng: bước Sơ đồ chỉ có khu đứng, lưu layout zones rỗng kèm ga_areas", async () => {
    const event = seedDraft();
    const GA = "31000000-0000-4000-8000-0000000000c1";
    state.organizer.ticketClasses.set(GA, {
      id: GA,
      event_id: event.id,
      name: "Standing",
      kind: "GA",
      price_vnd: 500_000,
      capacity: 100,
      version: 0,
      created_at: event.created_at,
      updated_at: event.created_at,
    });
    const user = userEvent.setup();
    asOrganizer(`/organizer/events/${event.id}?step=classes`);
    const steps = within(await screen.findByRole("list", { name: "Các bước" }));
    expect(text(steps.getByRole("button", { name: /^3\. Sơ đồ/ }))).toBe("3. Sơ đồchưa thiết lập");
    await user.click(steps.getByRole("button", { name: /^3\. Sơ đồ/ }));

    // Không có phần ghế; khu đứng lấy sẵn tên hạng.
    const area = await screen.findByLabelText(/^Khu đứng của hạng Standing · 100 vé/);
    expect(screen.queryByRole("list", { name: "Các block" })?.children.length ?? 0).toBe(0);
    expect(screen.queryByText("Tạo nhanh từ hạng vé")).toBeNull();
    expect(screen.queryByRole("button", { name: "+ Thêm block" })).toBeNull();

    // Tên rỗng thì báo lỗi, không lưu được.
    await user.clear(area);
    expect(text(screen.getByText("Nhập tên khu đứng"))).toBe("Nhập tên khu đứng");
    expect(screen.getByRole("button", { name: "Lưu sơ đồ" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("img")).toBeNull();
    await user.type(area, "Fanzone – giữa sân");
    // Xem trước: sơ đồ chỉ có khu đứng, không có ghế.
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Xem trước sơ đồ: khu đứng Fanzone – giữa sân.",
    );
    await user.click(screen.getByRole("button", { name: "Lưu sơ đồ" }));
    await screen.findByText("Đã lưu sơ đồ phiên bản 1.");
    const [map] = [...state.organizer.seatMaps.values()];
    expect(map?.layout).toEqual({
      zones: [],
      ga_areas: [{ name: "Fanzone – giữa sân", ticket_class_id: GA }],
    });
    expect(screen.getByRole("button", { name: "Tiếp →" })).toHaveProperty("disabled", false);
    await waitFor(() =>
      expect(text(steps.getByRole("button", { name: /^3\. Sơ đồ/ }))).toBe(
        "3. Sơ đồđang thực hiện",
      ),
    );
  });

  it("chưa có hạng vé: bước Sơ đồ chỉ cách quay lại Hạng vé", async () => {
    const event = seedDraft();
    const user = userEvent.setup();
    asOrganizer(`/organizer/events/${event.id}?step=seatmap`);
    expect(text(await screen.findByText(/chưa có hạng vé/))).toContain("Quay lại bước Hạng vé");
    expect(screen.queryByRole("button", { name: "Lưu sơ đồ" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sửa hạng vé" }));
    await screen.findByRole("heading", { level: 2, name: "Hạng vé" });
  });

  it("dữ liệu đã đổi ở nơi khác (409) → báo lỗi và tải bản mới", async () => {
    const event = seedDraft();
    const user = userEvent.setup();
    asOrganizer(`/organizer/events/${event.id}`);
    const title = await screen.findByLabelText("Tên sự kiện");
    // Một tab khác vừa đổi tên sự kiện.
    state.organizer.events.set(event.id, { ...event, title: "Tên từ tab khác", version: 1 });
    await user.clear(title);
    await user.type(title, "Tên của tôi");
    await user.click(screen.getByRole("button", { name: "Lưu và tiếp: Hạng vé →" }));
    expect(text(await screen.findByRole("alert"))).toBe(
      "Dữ liệu vừa được thay đổi ở nơi khác. Đã tải bản mới nhất, kiểm tra rồi lưu lại.",
    );
    await waitFor(() =>
      expect((screen.getByLabelText("Tên sự kiện") as HTMLInputElement).value).toBe(
        "Tên từ tab khác",
      ),
    );
    expect(state.organizer.events.get(event.id)?.title).toBe("Tên từ tab khác");
  });

  it("ảnh banner sai loại bị chặn trước khi tải lên", async () => {
    const event = seedDraft();
    const user = userEvent.setup({ applyAccept: false });
    asOrganizer(`/organizer/events/${event.id}?step=banner`);
    const gif = new File([new Uint8Array(10)], "banner.gif", { type: "image/gif" });
    await user.upload(await screen.findByLabelText("Chọn ảnh banner"), gif);
    expect(text(screen.getByText("Chỉ nhận ảnh JPEG, PNG hoặc WebP."))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tải ảnh lên" })).toBeNull();
    expect(state.organizer.bannerStaging.size).toBe(0);
  });

  it("ảnh khai là PNG nhưng nội dung không phải PNG: server từ chối, không gắn banner", async () => {
    const event = seedDraft();
    const user = userEvent.setup();
    asOrganizer(`/organizer/events/${event.id}?step=banner`);
    const fake = new File([new Uint8Array(64)], "banner.png", { type: "image/png" });
    await user.upload(await screen.findByLabelText("Chọn ảnh banner"), fake);
    await user.click(screen.getByRole("button", { name: "Tải ảnh lên" }));
    expect(
      text(
        await screen.findByText("Tệp không phải ảnh JPEG, PNG hoặc WebP hợp lệ, hoặc ảnh bị hỏng."),
      ),
    ).toBeTruthy();
    expect(state.organizer.events.get(event.id)?.banner_key).toBeNull();
    expect(state.organizer.bannerStaging.size).toBe(0);
    expect(state.organizer.bannerPublic.size).toBe(0);
  });

  it("sự kiện đã gửi duyệt chỉ xem được", async () => {
    const event = seedDraft({ status: "PENDING" });
    asOrganizer(`/organizer/events/${event.id}`);
    expect(text(await screen.findByText(/chỉ xem/))).toBe(
      "Sự kiện đang ở trạng thái “Chờ duyệt” nên chỉ xem được, không sửa được.",
    );
    // Ô nằm trong <fieldset disabled>: thuộc tính disabled của ô vẫn false, kiểm bằng :disabled.
    expect(screen.getByLabelText("Tên sự kiện").matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "Lưu và tiếp: Hạng vé →" })).toBeNull();
  });

  it("danh sách sự kiện hiện trạng thái và mở lại wizard", async () => {
    const event = seedDraft();
    const user = userEvent.setup();
    const { router } = asOrganizer("/organizer");
    const list = await screen.findByRole("list", { name: "Danh sách sự kiện" });
    expect(text(within(list).getByRole("listitem"))).toContain("Bản nháp");
    await user.click(within(list).getByRole("link", { name: `Mở ${event.title}` }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/organizer/events/${event.id}`),
    );
  });
});
