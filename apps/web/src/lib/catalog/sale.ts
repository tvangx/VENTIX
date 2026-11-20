import type { EventSchemas } from "@/lib/api";
import type { SaleStatus } from "./filters";
import { formatDayMonth } from "./format";

export type CatalogCard = EventSchemas["schemas"]["CatalogCard"];
export type CatalogDetail = EventSchemas["schemas"]["CatalogDetail"];
export type SalePhase = EventSchemas["schemas"]["SalePhaseResponse"];
export type TicketClass = EventSchemas["schemas"]["TicketClassResponse"];

export interface SaleState {
  status: SaleStatus;
  /** Đợt đang mở, nếu không thì đợt sắp mở gần nhất. */
  phase: SalePhase | null;
  /** Số thứ tự (bắt đầu từ 1) của `phase` trong danh sách đợt đã sắp theo thời gian. */
  phaseNumber: number | null;
}

/**
 * Tình trạng bán theo lịch đợt bán, cùng quy tắc `catalogSaleSummary` của event-service (thẻ danh
 * sách đã có sẵn `sale_status`; trang chi tiết phải tự tính từ `sale_phases`).
 */
export function saleStateOf(phases: SalePhase[], now: number): SaleState {
  const sorted = sortPhases(phases);
  const index = sorted.findIndex(
    (p) => Date.parse(p.starts_at) <= now && Date.parse(p.ends_at) > now,
  );
  const nextIndex = sorted.findIndex((p) => Date.parse(p.starts_at) > now);
  const chosen = index >= 0 ? index : nextIndex;
  return {
    status: index >= 0 ? "ON_SALE" : nextIndex >= 0 ? "UPCOMING" : "CLOSED",
    phase: chosen >= 0 ? (sorted[chosen] ?? null) : null,
    phaseNumber: chosen >= 0 ? chosen + 1 : null,
  };
}

export function sortPhases(phases: SalePhase[]): SalePhase[] {
  return [...phases].sort(
    (a, b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id),
  );
}

/** Nhãn ngắn trên thẻ sự kiện. */
export function cardStatusLabel(card: CatalogCard): string {
  if (card.sale_status === "ON_SALE") {
    return card.sale_queue_enabled ? "Đang mở bán · có hàng chờ" : "Đang mở bán";
  }
  if (card.sale_status === "UPCOMING" && card.next_sale_starts_at) {
    return `Mở bán ${formatDayMonth(card.next_sale_starts_at)}`;
  }
  return "Đã đóng bán";
}

/**
 * Ảnh banner: `banner_key` là khóa object (MinIO). Hiện chỉ ảnh seed V-104 có đường dẫn công khai
 * (apps/web/public/seed/banners); khóa khác chưa có URL nên thẻ dùng bìa poster chữ.
 */
export function bannerSrc(bannerKey: string | null): string | null {
  return bannerKey && /^seed\/banners\/[a-z0-9-]+\.jpg$/.test(bannerKey) ? `/${bannerKey}` : null;
}

export type TierTone = 1 | 2 | 3 | 4;

/**
 * Màu hạng vé theo quy chuẩn V-105: hạng đắt nhất xanh lá nhạt, rồi xanh lá đậm, xanh lá, xám.
 * Sự kiện có hơn 4 hạng thì các hạng rẻ hơn dùng màu xám.
 */
export function tierTones(classes: TicketClass[]): Map<string, TierTone> {
  const byPrice = [...classes].sort(
    (a, b) => b.price_vnd - a.price_vnd || a.id.localeCompare(b.id),
  );
  return new Map(byPrice.map((tc, i) => [tc.id, Math.min(i + 1, 4) as TierTone]));
}

/** Nút hành động chính ở trang chi tiết. */
export function primaryAction(
  detail: CatalogDetail,
  sale: SaleState,
  now: number,
): { label: string; enabled: boolean } {
  if (Date.parse(detail.end_at) <= now) return { label: "Đã diễn ra", enabled: false };
  if (sale.status === "CLOSED") return { label: "Đã đóng bán", enabled: false };
  if (sale.status === "UPCOMING") {
    const start = sale.phase ? ` ${formatDayMonth(sale.phase.starts_at)}` : "";
    return { label: `Mở bán${start}`, enabled: false };
  }
  if (sale.phase?.queue_enabled) return { label: "Vào phòng chờ", enabled: true };
  const seated = detail.ticket_classes.some((tc) => tc.kind === "SEATED");
  return { label: seated ? "Chọn ghế" : "Mua vé", enabled: true };
}
