// Chọn ghế phía client (chưa giữ ghế thật; giữ ghế qua booking là V-301).

export type SeatStatus = "sold" | "held";

export type ToggleResult =
  | { ok: true; selected: string[] }
  | { ok: false; reason: "UNAVAILABLE" | "LIMIT_REACHED" | "SELECTION_CLOSED" };

/**
 * Bấm vào ghế: đang chọn thì bỏ; còn trống và chưa tới giới hạn thì thêm.
 * `statuses` theo khóa ghế (đã bán / người khác đang giữ); thiếu nghĩa là còn trống.
 */
export function toggleSeat(
  selected: readonly string[],
  key: string,
  limit: number,
  statuses: ReadonlyMap<string, SeatStatus>,
): ToggleResult {
  if (selected.includes(key)) {
    return { ok: true, selected: selected.filter((item) => item !== key) };
  }
  if (limit <= 0) return { ok: false, reason: "SELECTION_CLOSED" };
  if (statuses.has(key)) return { ok: false, reason: "UNAVAILABLE" };
  if (selected.length >= limit) return { ok: false, reason: "LIMIT_REACHED" };
  return { ok: true, selected: [...selected, key] };
}

export const TOGGLE_MESSAGES: Record<Exclude<ToggleResult, { ok: true }>["reason"], string> = {
  UNAVAILABLE: "Ghế này không còn trống, hãy chọn ghế khác.",
  LIMIT_REACHED: "Bạn đã chọn đủ số ghế tối đa của đợt mở bán.",
  SELECTION_CLOSED: "Sự kiện chưa mở bán hoặc đã đóng bán, chưa chọn ghế được.",
};
