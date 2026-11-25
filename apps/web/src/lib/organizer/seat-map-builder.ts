import type { SeatMapLayout } from "@/lib/seatmap/layout";

// Sinh layout seat map từ vài con số Organizer nhập, theo cách gọi đã chốt ở V-202:
// mỗi hạng SEATED là một Block (A, B…) = `zones[]` của hợp đồng; Block chia thành các Khu A1, A2…
// = `zones[].blocks[]`; mỗi Khu có các hàng A, B… với cùng số ghế.
// Giới hạn khớp services/event/.../seat-map.layout.ts.

export const LIMITS = {
  blocks: 100,
  khuPerBlock: 100,
  rowsPerKhu: 200,
  seatsPerRow: 1000,
  totalSeats: 100_000,
} as const;

export interface BlockPlan {
  ticketClassId: string;
  khuCount: number;
  rowsPerKhu: number;
  seatsPerRow: number;
}

export interface SeatedClass {
  id: string;
  name: string;
  capacity: number;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 0 → "A", 25 → "Z", 26 → "AA"… */
export function letterLabel(index: number): string {
  let n = index;
  let label = "";
  do {
    label = `${LETTERS[n % 26] ?? "A"}${label}`;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function seatsOf(plan: BlockPlan): number {
  return plan.khuCount * plan.rowsPerKhu * plan.seatsPerRow;
}

/** Ước số nhỏ nhất `k` của `rows` sao cho mỗi khu ≤ `maxRows` hàng và số khu trong giới hạn. */
function splitRows(rows: number, maxRows: number): number | null {
  for (let k = 1; k <= LIMITS.khuPerBlock; k += 1) {
    if (rows % k === 0 && rows / k <= maxRows) return k;
  }
  return null;
}

/**
 * Gợi ý số khu/hàng/ghế cho đúng `capacity` ghế: ưu tiên hàng ≤ 20 ghế và khu ≤ 20 hàng (≤ 400
 * ghế), nới dần tới giới hạn API. Số nguyên tố lớn không chia được thì gợi ý gần đúng; Organizer
 * sửa tay, bước sơ đồ ghế báo lệch.
 */
export function suggestPlan(ticketClassId: string, capacity: number): BlockPlan {
  const widths = [
    ...Array.from({ length: 20 }, (_, i) => 20 - i),
    ...Array.from({ length: LIMITS.seatsPerRow - 20 }, (_, i) => 21 + i),
  ];
  for (const maxRows of [20, LIMITS.rowsPerKhu]) {
    for (const seatsPerRow of widths) {
      if (capacity % seatsPerRow !== 0) continue;
      const rows = capacity / seatsPerRow;
      const khuCount = splitRows(rows, maxRows);
      if (khuCount !== null) {
        return { ticketClassId, khuCount, rowsPerKhu: rows / khuCount, seatsPerRow };
      }
    }
  }
  const seatsPerRow = Math.min(20, capacity);
  const rows = Math.ceil(capacity / seatsPerRow);
  const khuCount = Math.min(LIMITS.khuPerBlock, Math.max(1, Math.ceil(rows / 20)));
  return { ticketClassId, khuCount, rowsPerKhu: Math.ceil(rows / khuCount), seatsPerRow };
}

export type PlanIssue =
  | { kind: "range"; ticketClassId: string; field: keyof Omit<BlockPlan, "ticketClassId"> }
  | { kind: "capacity"; ticketClassId: string; seats: number; capacity: number }
  | { kind: "total"; seats: number }
  | { kind: "blocks" };

const RANGE: Record<keyof Omit<BlockPlan, "ticketClassId">, number> = {
  khuCount: LIMITS.khuPerBlock,
  rowsPerKhu: LIMITS.rowsPerKhu,
  seatsPerRow: LIMITS.seatsPerRow,
};

/** Kiểm tra kế hoạch: trong giới hạn của API, và tổng ghế của mỗi hạng bằng số lượng của hạng. */
export function checkPlans(plans: BlockPlan[], classes: SeatedClass[]): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (plans.length === 0 || plans.length > LIMITS.blocks) issues.push({ kind: "blocks" });
  let total = 0;
  for (const plan of plans) {
    let inRange = true;
    for (const field of Object.keys(RANGE) as (keyof typeof RANGE)[]) {
      const value = plan[field];
      if (!Number.isInteger(value) || value < 1 || value > RANGE[field]) {
        issues.push({ kind: "range", ticketClassId: plan.ticketClassId, field });
        inRange = false;
      }
    }
    if (!inRange) continue;
    const seats = seatsOf(plan);
    total += seats;
    const capacity = classes.find((c) => c.id === plan.ticketClassId)?.capacity ?? 0;
    if (seats !== capacity) {
      issues.push({ kind: "capacity", ticketClassId: plan.ticketClassId, seats, capacity });
    }
  }
  if (total > LIMITS.totalSeats) issues.push({ kind: "total", seats: total });
  return issues;
}

/** Layout gửi `POST seat-maps`. Gọi sau khi `checkPlans` không còn lỗi. */
export function buildLayout(plans: BlockPlan[]): SeatMapLayout {
  return {
    zones: plans.map((plan, bi) => {
      const block = letterLabel(bi);
      return {
        name: `Block ${block}`,
        blocks: Array.from({ length: plan.khuCount }, (_, ki) => ({
          name: `${block}${ki + 1}`,
          rows: Array.from({ length: plan.rowsPerKhu }, (_, ri) => ({
            label: letterLabel(ri),
            seats: plan.seatsPerRow,
            ticket_class_id: plan.ticketClassId,
          })),
        })),
      };
    }),
  };
}
