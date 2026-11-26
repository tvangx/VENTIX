import { parseAnyLayout } from "@/lib/seatmap/layout";
import type { EventBundle } from "./api";

// Điều kiện hoàn tất từng bước của wizard và điều kiện gửi duyệt.

export function seatedClasses(bundle: EventBundle) {
  return bundle.ticketClasses.filter((c) => c.kind === "SEATED");
}

export function gaClasses(bundle: EventBundle) {
  return bundle.ticketClasses.filter((c) => c.kind === "GA");
}

/**
 * Sơ đồ khớp hạng vé:
 * - mọi hạng SEATED có trong sơ đồ với đúng số ghế bằng số lượng, và ghế không trỏ tới hạng khác
 *   (event-service chặn publish nếu lệch: SEAT_MAP_CLASS_MISMATCH);
 * - mỗi hạng GA gắn đúng một khu đứng (`ga_areas`, issue #98) để khán giả biết khu nằm ở đâu.
 *   Server cho phép thiếu khu đứng; wizard bắt buộc để sơ đồ đủ cho trang khán giả.
 */
export function seatMapMatches(bundle: EventBundle): boolean {
  const seated = seatedClasses(bundle);
  const ga = gaClasses(bundle);
  if (seated.length === 0 && ga.length === 0) return true;
  const layout = bundle.seatMap ? parseAnyLayout(bundle.seatMap.layout) : null;
  if (!layout) return false;
  const counts = new Map<string, number>();
  for (const zone of layout.zones) {
    for (const block of zone.blocks) {
      for (const row of block.rows) {
        counts.set(row.ticket_class_id, (counts.get(row.ticket_class_id) ?? 0) + row.seats);
      }
    }
  }
  if (counts.size !== seated.length) return false;
  if (!seated.every((c) => counts.get(c.id) === c.capacity)) return false;
  const areaClasses = (layout.ga_areas ?? []).map((a) => a.ticket_class_id);
  if (new Set(areaClasses).size !== areaClasses.length || areaClasses.length !== ga.length) {
    return false;
  }
  return ga.every((c) => areaClasses.includes(c.id));
}

export interface Readiness {
  info: boolean;
  classes: boolean;
  seatmap: boolean;
  phases: boolean;
  banner: boolean;
}

export function readiness(bundle: EventBundle | undefined): Readiness {
  if (!bundle) return { info: false, classes: false, seatmap: false, phases: false, banner: false };
  return {
    info: true,
    classes: bundle.ticketClasses.length > 0,
    seatmap: bundle.ticketClasses.length > 0 && seatMapMatches(bundle),
    phases: bundle.salePhases.length > 0,
    banner: bundle.event.banner_key !== null,
  };
}

/** Gửi duyệt cần: thông tin, ít nhất một hạng vé, seat map khớp, ít nhất một đợt bán. Banner tùy chọn. */
export function canSubmit(r: Readiness): boolean {
  return r.info && r.classes && r.seatmap && r.phases;
}
