import type { SeatMapLayout } from "@/lib/seatmap/layout";
import { parseIntegerInput } from "./forms";
import { LIMITS } from "./seat-map-builder";

// Bản nháp sơ đồ ghế mà Organizer sửa trong wizard: Block (= `zones[]` của hợp đồng) → Khu
// (= `zones[].blocks[]`) → hàng (`rows[]`: nhãn, số ghế, hạng vé). Mỗi hàng có số ghế và hạng vé
// riêng; tên Block/Khu/hàng tự đặt; số khu, số hàng không cần đều nhau.
// Kiểm tra bám services/event/.../seat-map.layout.ts: tên cắt khoảng trắng hai đầu rồi phải còn
// ký tự, Block không trùng tên, Khu không trùng tên trong một Block, nhãn hàng không trùng trong một
// Khu, ghế 1–1.000/hàng, tổng ≤ 100.000. Thêm ràng buộc của wizard: tổng ghế mỗi hạng = số lượng.
// Khu đứng (`ga_areas`, issue #98): mỗi hạng GA gắn đúng một khu; tên khu đứng không trùng tên
// Block hay khu đứng khác (server dùng chung một không gian tên cho `zones[]` và `ga_areas[]`).

export const NAME_MAX = 128;
export const LABEL_MAX = 16;
export const LAYOUT_LIMITS = { zones: 100, khuPerBlock: 100, rowsPerKhu: 200 } as const;

export interface DraftRow {
  /** Khóa ổn định cho React, không gửi lên server. */
  key: string;
  label: string;
  /** Chuỗi để gõ dở được ("", "1.000"); đổi sang số khi kiểm tra. */
  seats: string;
  ticketClassId: string;
}

export interface DraftKhu {
  key: string;
  name: string;
  rows: DraftRow[];
}

export interface DraftBlock {
  key: string;
  name: string;
  khus: DraftKhu[];
}

export type Draft = DraftBlock[];

/** Khu đứng của một hạng GA. Mỗi hạng GA đúng một khu nên khóa là `ticketClassId`. */
export interface DraftGaArea {
  ticketClassId: string;
  name: string;
}

let counter = 0;
export const newKey = () => {
  counter += 1;
  return `k${counter}`;
};

export function draftFromLayout(layout: SeatMapLayout): Draft {
  return layout.zones.map((zone) => ({
    key: newKey(),
    name: zone.name,
    khus: zone.blocks.map((khu) => ({
      key: newKey(),
      name: khu.name,
      rows: khu.rows.map((row) => ({
        key: newKey(),
        label: row.label,
        seats: String(row.seats),
        ticketClassId: row.ticket_class_id,
      })),
    })),
  }));
}

/**
 * Khu đứng cho từng hạng GA (theo thứ tự hạng vé): lấy tên đã lưu nếu có, chưa có thì lấy tên hạng
 * để Organizer sửa lại cho rõ vị trí.
 */
export function gaDraftFrom(
  layout: SeatMapLayout | null,
  gaClasses: { id: string; name: string }[],
): DraftGaArea[] {
  // Giữ thứ tự khu đứng đã lưu (thứ tự = vị trí trái → phải trên sơ đồ); hạng mới nối cuối.
  const saved = layout?.ga_areas ?? [];
  const rank = new Map(saved.map((a, i) => [a.ticket_class_id, i]));
  const names = new Map(saved.map((a) => [a.ticket_class_id, a.name]));
  return [...gaClasses]
    .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity))
    .map((c) => ({
      ticketClassId: c.id,
      name: (names.get(c.id) ?? c.name).slice(0, NAME_MAX),
    }));
}

/** Đổi chỗ phần tử `from` với phần tử kề bên (`step` = -1 lên/trái, +1 xuống/phải). Ra ngoài biên thì giữ nguyên. */
export function moveItem<T>(list: readonly T[], from: number, step: -1 | 1): T[] {
  const to = from + step;
  const a = list[from];
  const b = list[to];
  if (a === undefined || b === undefined) return [...list];
  const next = [...list];
  next[from] = b;
  next[to] = a;
  return next;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Nhãn kế tiếp để thêm hàng nhanh: "A" → "B", "Z" → "AA", "AZ" → "BA", "9" → "10", "H9" → "H10".
 * Nhãn không đoán được thì trả "".
 */
export function nextLabel(label: string): string {
  const trimmed = label.trim();
  const numeric = /^(.*?)(\d+)$/.exec(trimmed);
  if (numeric) return `${numeric[1] ?? ""}${Number(numeric[2]) + 1}`;
  if (!/^[A-Z]+$/.test(trimmed)) return "";
  const chars = trimmed.split("");
  for (let i = chars.length - 1; i >= 0; i -= 1) {
    const idx = LETTERS.indexOf(chars[i] ?? "A");
    if (idx < 25) {
      chars[i] = LETTERS[idx + 1] ?? "A";
      return chars.join("");
    }
    chars[i] = "A";
  }
  return `A${chars.join("")}`;
}

/** Tên kế tiếp cho Block/Khu mới, tránh trùng các tên đã có: "Block C", "B3"… */
export function nextName(existing: string[], make: (n: number) => string): string {
  const taken = new Set(existing.map((n) => n.trim()));
  for (let n = 1; n <= 1000; n += 1) {
    const name = make(n);
    if (!taken.has(name)) return name;
  }
  return "";
}

/** Hàng mới nối tiếp hàng cuối: nhãn kế tiếp, cùng số ghế và hạng vé. */
export function rowAfter(khu: DraftKhu, fallbackClassId: string): DraftRow {
  const last = khu.rows[khu.rows.length - 1];
  return {
    key: newKey(),
    label: last ? nextLabel(last.label) : "A",
    seats: last?.seats ?? "10",
    ticketClassId: last?.ticketClassId ?? fallbackClassId,
  };
}

export type IssuePath =
  | { level: "map" }
  | { level: "block"; block: number }
  | { level: "khu"; block: number; khu: number }
  | { level: "ga"; area: number }
  | { level: "row"; block: number; khu: number; row: number; field: "label" | "seats" | "class" };

export interface EditorIssue {
  path: IssuePath;
  message: string;
}

export interface SeatedClassInfo {
  id: string;
  name: string;
  capacity: number;
}

export interface CheckResult {
  issues: EditorIssue[];
  /** Layout gửi API, chỉ có khi không còn lỗi. */
  layout: SeatMapLayout | null;
  totalSeats: number;
  /** Số ghế theo hạng vé (chỉ tính hàng hợp lệ). */
  seatsByClass: Map<string, number>;
}

function nameIssue(value: string, max: number, what: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return `Nhập ${what}`;
  if (trimmed.length > max)
    return `${what[0]?.toUpperCase() ?? ""}${what.slice(1)} tối đa ${max} ký tự`;
  return null;
}

export function checkDraft(
  draft: Draft,
  classes: SeatedClassInfo[],
  gaAreas: DraftGaArea[] = [],
): CheckResult {
  const issues: EditorIssue[] = [];
  const seatsByClass = new Map<string, number>();
  const classIds = new Set(classes.map((c) => c.id));
  let total = 0;

  if (draft.length === 0 && classes.length > 0)
    issues.push({ path: { level: "map" }, message: "Thêm ít nhất một block" });
  if (classes.length === 0 && gaAreas.length === 0)
    issues.push({ path: { level: "map" }, message: "Thêm hạng vé trước khi làm sơ đồ" });
  if (draft.length > LAYOUT_LIMITS.zones) {
    issues.push({ path: { level: "map" }, message: `Tối đa ${LAYOUT_LIMITS.zones} block` });
  }

  const blockNames = new Set<string>();
  draft.forEach((block, bi) => {
    const blockPath = { level: "block", block: bi } as const;
    const bad = nameIssue(block.name, NAME_MAX, "tên block");
    if (bad) issues.push({ path: blockPath, message: bad });
    else if (blockNames.has(block.name.trim())) {
      issues.push({ path: blockPath, message: `Trùng tên block “${block.name.trim()}”` });
    }
    blockNames.add(block.name.trim());
    if (block.khus.length === 0)
      issues.push({ path: blockPath, message: "Block cần ít nhất một khu" });
    if (block.khus.length > LAYOUT_LIMITS.khuPerBlock) {
      issues.push({
        path: blockPath,
        message: `Tối đa ${LAYOUT_LIMITS.khuPerBlock} khu mỗi block`,
      });
    }

    const khuNames = new Set<string>();
    block.khus.forEach((khu, ki) => {
      const khuPath = { level: "khu", block: bi, khu: ki } as const;
      const badKhu = nameIssue(khu.name, NAME_MAX, "tên khu");
      if (badKhu) issues.push({ path: khuPath, message: badKhu });
      else if (khuNames.has(khu.name.trim())) {
        issues.push({ path: khuPath, message: `Trùng tên khu “${khu.name.trim()}” trong block` });
      }
      khuNames.add(khu.name.trim());
      if (khu.rows.length === 0)
        issues.push({ path: khuPath, message: "Khu cần ít nhất một hàng" });
      if (khu.rows.length > LAYOUT_LIMITS.rowsPerKhu) {
        issues.push({ path: khuPath, message: `Tối đa ${LAYOUT_LIMITS.rowsPerKhu} hàng mỗi khu` });
      }

      const labels = new Set<string>();
      khu.rows.forEach((row, ri) => {
        const at = (field: "label" | "seats" | "class") =>
          ({ level: "row", block: bi, khu: ki, row: ri, field }) as const;
        const badLabel = nameIssue(row.label, LABEL_MAX, "nhãn hàng");
        if (badLabel) issues.push({ path: at("label"), message: badLabel });
        else if (labels.has(row.label.trim())) {
          issues.push({ path: at("label"), message: `Trùng nhãn hàng “${row.label.trim()}”` });
        }
        labels.add(row.label.trim());
        const seats = parseIntegerInput(row.seats);
        if (seats === null || seats < 1 || seats > LIMITS.seatsPerRow) {
          issues.push({
            path: at("seats"),
            message: `Số ghế từ 1 đến ${LIMITS.seatsPerRow.toLocaleString("vi-VN")}`,
          });
        }
        if (!classIds.has(row.ticketClassId)) {
          issues.push({ path: at("class"), message: "Chọn hạng vé" });
        }
        if (seats !== null && seats >= 1 && seats <= LIMITS.seatsPerRow) {
          total += seats;
          if (classIds.has(row.ticketClassId)) {
            seatsByClass.set(row.ticketClassId, (seatsByClass.get(row.ticketClassId) ?? 0) + seats);
          }
        }
      });
    });
  });

  const usedNames = new Set(blockNames);
  gaAreas.forEach((area, ai) => {
    const path = { level: "ga", area: ai } as const;
    const bad = nameIssue(area.name, NAME_MAX, "tên khu đứng");
    if (bad) issues.push({ path, message: bad });
    else if (usedNames.has(area.name.trim())) {
      issues.push({
        path,
        message: `Tên “${area.name.trim()}” trùng một block hoặc khu đứng khác`,
      });
    }
    usedNames.add(area.name.trim());
  });

  if (total > LIMITS.totalSeats) {
    issues.push({
      path: { level: "map" },
      message: `Tổng ${total.toLocaleString("vi-VN")} ghế vượt giới hạn ${LIMITS.totalSeats.toLocaleString("vi-VN")}`,
    });
  }
  for (const c of classes) {
    const seats = seatsByClass.get(c.id) ?? 0;
    if (seats !== c.capacity) {
      issues.push({
        path: { level: "map" },
        message: `${c.name}: sơ đồ có ${seats.toLocaleString("vi-VN")} ghế, hạng có ${c.capacity.toLocaleString("vi-VN")} vé. Hai số phải bằng nhau.`,
      });
    }
  }

  const layout: SeatMapLayout | null =
    issues.length === 0
      ? {
          zones: draft.map((block) => ({
            name: block.name.trim(),
            blocks: block.khus.map((khu) => ({
              name: khu.name.trim(),
              rows: khu.rows.map((row) => ({
                label: row.label.trim(),
                seats: parseIntegerInput(row.seats) ?? 0,
                ticket_class_id: row.ticketClassId,
              })),
            })),
          })),
          ...(gaAreas.length > 0
            ? {
                ga_areas: gaAreas.map((a) => ({
                  name: a.name.trim(),
                  ticket_class_id: a.ticketClassId,
                })),
              }
            : {}),
        }
      : null;
  return { issues, layout, totalSeats: total, seatsByClass };
}

/** Số ghế của một khu (bỏ qua hàng nhập sai), để hiện ở tiêu đề khu. */
export function khuSeats(khu: DraftKhu): number {
  return khu.rows.reduce((sum, row) => {
    const n = parseIntegerInput(row.seats);
    return sum + (n !== null && n >= 1 && n <= LIMITS.seatsPerRow ? n : 0);
  }, 0);
}
