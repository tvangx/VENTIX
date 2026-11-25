import { describe, expect, it } from "vitest";
import { parseAnyLayout, parseLayout, type SeatMapLayout } from "@/lib/seatmap/layout";
import {
  checkDraft,
  draftFromLayout,
  gaDraftFrom,
  moveItem,
  nextLabel,
  nextName,
  rowAfter,
  type Draft,
} from "./seat-map-editor";

const VIP = "31000000-0000-4000-8000-000000000011";
const STD = "31000000-0000-4000-8000-000000000012";
const CLASSES = [
  { id: VIP, name: "VIP", capacity: 30 },
  { id: STD, name: "Standard", capacity: 20 },
];

// Sơ đồ không đều: hàng khác số ghế, một khu có hai hạng, hai khu khác số hàng, tên tự đặt.
const FREE_FORM: SeatMapLayout = {
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
        { name: "T2", rows: [{ label: "AA", seats: 15, ticket_class_id: STD }] },
      ],
    },
  ],
};

function messages(draft: Draft) {
  return checkDraft(draft, CLASSES).issues.map((i) => i.message);
}

describe("trình chỉnh sơ đồ ghế", () => {
  it("sơ đồ tự do hợp lệ: đọc vào rồi xuất ra đúng layout, đúng ràng buộc event-service", () => {
    const result = checkDraft(draftFromLayout(FREE_FORM), CLASSES);
    expect(result.issues).toEqual([]);
    expect(result.layout).toEqual(FREE_FORM);
    expect(parseLayout(result.layout)).not.toBeNull();
    expect(result.totalSeats).toBe(50);
    expect(result.seatsByClass).toEqual(
      new Map([
        [VIP, 30],
        [STD, 20],
      ]),
    );
  });

  it("tên cắt khoảng trắng; trùng tên block, khu trong block, nhãn hàng trong khu bị báo", () => {
    const draft = draftFromLayout({
      zones: [
        {
          name: " Tầng trệt ",
          blocks: [
            {
              name: "T1",
              rows: [
                { label: "A", seats: 10, ticket_class_id: VIP },
                { label: " A", seats: 20, ticket_class_id: VIP },
                { label: "C", seats: 5, ticket_class_id: STD },
              ],
            },
            { name: "T1 ", rows: [{ label: "A", seats: 15, ticket_class_id: STD }] },
          ],
        },
        {
          name: "Tầng trệt",
          blocks: [{ name: "T1", rows: [{ label: "A", seats: 1, ticket_class_id: STD }] }],
        },
      ],
    });
    const found = messages(draft);
    expect(found).toContain("Trùng nhãn hàng “A”");
    expect(found).toContain("Trùng tên khu “T1” trong block");
    expect(found).toContain("Trùng tên block “Tầng trệt”");
    // Khu T1 của block thứ hai không trùng với khu của block thứ nhất.
    expect(found.filter((m) => m.startsWith("Trùng tên khu"))).toHaveLength(1);
  });

  it("tên rỗng, ghế ngoài 1–1.000, thiếu hạng vé, khu không có hàng", () => {
    const draft = draftFromLayout(FREE_FORM);
    const t1 = draft[0]?.khus[0];
    const t2 = draft[0]?.khus[1];
    if (!t1 || !t2 || !draft[0]) throw new Error("thiếu dữ liệu");
    draft[0].name = "  ";
    t1.rows[0] = { ...t1.rows[0]!, seats: "1.001" };
    t1.rows[1] = { ...t1.rows[1]!, ticketClassId: "" };
    t1.rows[2] = { ...t1.rows[2]!, label: "" };
    t2.rows = [];
    const found = messages(draft);
    expect(found).toEqual(
      expect.arrayContaining([
        "Nhập tên block",
        "Số ghế từ 1 đến 1.000",
        "Chọn hạng vé",
        "Nhập nhãn hàng",
        "Khu cần ít nhất một hàng",
      ]),
    );
    expect(checkDraft(draft, CLASSES).layout).toBeNull();
  });

  it("tổng ghế mỗi hạng phải bằng số vé của hạng", () => {
    const draft = draftFromLayout(FREE_FORM);
    const row = draft[0]?.khus[0]?.rows[0];
    if (!row) throw new Error("thiếu hàng");
    row.seats = "11";
    expect(messages(draft)).toEqual([
      "VIP: sơ đồ có 31 ghế, hạng có 30 vé. Hai số phải bằng nhau.",
    ]);
    expect(messages([])).toEqual([
      "Thêm ít nhất một block",
      "VIP: sơ đồ có 0 ghế, hạng có 30 vé. Hai số phải bằng nhau.",
      "Standard: sơ đồ có 0 ghế, hạng có 20 vé. Hai số phải bằng nhau.",
    ]);
  });

  it("nhãn và tên kế tiếp khi thêm nhanh", () => {
    expect(["A", "Z", "AZ", "ZZ", "9", "H9", "Lô-2", "a?"].map(nextLabel)).toEqual([
      "B",
      "AA",
      "BA",
      "AAA",
      "10",
      "H10",
      "Lô-3",
      "",
    ]);
    expect(nextName(["T1", "T2"], (n) => `T${n}`)).toBe("T3");
    expect(nextName(["T2"], (n) => `T${n}`)).toBe("T1");
  });

  it("hàng mới nối tiếp hàng cuối: nhãn kế, cùng số ghế và hạng", () => {
    const khu = draftFromLayout(FREE_FORM)[0]?.khus[0];
    if (!khu) throw new Error("thiếu khu");
    expect(rowAfter(khu, VIP)).toMatchObject({ label: "D", seats: "5", ticketClassId: STD });
    expect(rowAfter({ ...khu, rows: [] }, VIP)).toMatchObject({
      label: "A",
      seats: "10",
      ticketClassId: VIP,
    });
  });
});

describe("khu đứng (ga_areas, issue #98)", () => {
  const GA1 = "31000000-0000-4000-8000-000000000021";
  const GA2 = "31000000-0000-4000-8000-000000000022";
  const GA_CLASSES = [
    { id: GA1, name: "GA Trái" },
    { id: GA2, name: "GA Phải" },
  ];

  it("mặc định lấy tên hạng, giữ tên đã lưu", () => {
    expect(gaDraftFrom(null, GA_CLASSES)).toEqual([
      { ticketClassId: GA1, name: "GA Trái" },
      { ticketClassId: GA2, name: "GA Phải" },
    ]);
    const saved: SeatMapLayout = {
      zones: [],
      ga_areas: [{ name: "Khu đứng A – sát sân khấu", ticket_class_id: GA2 }],
    };
    // Khu đã lưu giữ thứ tự đã lưu; hạng chưa có khu nối cuối.
    expect(gaDraftFrom(saved, GA_CLASSES).map((a) => a.name)).toEqual([
      "Khu đứng A – sát sân khấu",
      "GA Trái",
    ]);
  });

  it("giữ thứ tự khu đứng đã lưu (thứ tự = vị trí trái → phải)", () => {
    const saved: SeatMapLayout = {
      zones: [],
      ga_areas: [
        { name: "Phải", ticket_class_id: GA2 },
        { name: "Trái", ticket_class_id: GA1 },
      ],
    };
    expect(gaDraftFrom(saved, GA_CLASSES).map((a) => a.ticketClassId)).toEqual([GA2, GA1]);
  });

  it("chỉ vé đứng: layout zones rỗng kèm ga_areas, đúng hợp đồng", () => {
    const result = checkDraft(
      [],
      [],
      [
        { ticketClassId: GA1, name: "  Khu đứng A  " },
        { ticketClassId: GA2, name: "Khu đứng B" },
      ],
    );
    expect(result.issues).toEqual([]);
    expect(result.layout).toEqual({
      zones: [],
      ga_areas: [
        { name: "Khu đứng A", ticket_class_id: GA1 },
        { name: "Khu đứng B", ticket_class_id: GA2 },
      ],
    });
    expect(parseAnyLayout(result.layout)).not.toBeNull();
    // Viewer/chọn ghế cần ít nhất một zone: layout toàn khu đứng không qua parseLayout.
    expect(parseLayout(result.layout)).toBeNull();
  });

  it("tên khu đứng rỗng hoặc trùng block/khu đứng khác bị báo lỗi", () => {
    const draft = draftFromLayout(FREE_FORM);
    const blockName = draft[0]?.name ?? "";
    const result = checkDraft(draft, CLASSES, [
      { ticketClassId: GA1, name: " " },
      { ticketClassId: GA2, name: blockName },
    ]);
    expect(result.layout).toBeNull();
    expect(result.issues.filter((i) => i.path.level === "ga")).toEqual([
      { path: { level: "ga", area: 0 }, message: "Nhập tên khu đứng" },
      {
        path: { level: "ga", area: 1 },
        message: `Tên “${blockName}” trùng một block hoặc khu đứng khác`,
      },
    ]);
  });

  it("không có hạng vé nào thì báo cần thêm hạng", () => {
    expect(checkDraft([], []).issues.map((i) => i.message)).toEqual([
      "Thêm hạng vé trước khi làm sơ đồ",
    ]);
  });
});

describe("đổi thứ tự", () => {
  it("đổi chỗ với phần tử kề bên, không đổi mảng gốc", () => {
    const list = ["A", "B", "C"];
    expect(moveItem(list, 1, -1)).toEqual(["B", "A", "C"]);
    expect(moveItem(list, 1, 1)).toEqual(["A", "C", "B"]);
    expect(list).toEqual(["A", "B", "C"]);
  });

  it("ra ngoài biên thì giữ nguyên", () => {
    expect(moveItem(["A", "B"], 0, -1)).toEqual(["A", "B"]);
    expect(moveItem(["A", "B"], 1, 1)).toEqual(["A", "B"]);
  });
});
