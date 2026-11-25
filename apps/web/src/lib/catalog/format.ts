// Định dạng hiển thị cho catalog. API trả thời gian UTC; người mua ở Việt Nam nên mọi giờ hiển thị
// theo Asia/Ho_Chi_Minh (UTC+7, không có giờ mùa hè). Tiền là số nguyên VND.

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"] as const;

const vndFormatter = new Intl.NumberFormat("vi-VN");

/** 1500000 → "1.500.000đ". */
export function formatVnd(amount: number): string {
  return `${vndFormatter.format(amount)}đ`;
}

const compactFormatter = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** Số tiền lớn ghi gọn: 4500000000 → "4,5 tỷ", 800000000 → "800 triệu", 500000 → "500.000đ". */
export function formatCompactVnd(amount: number): string {
  if (amount >= 1e9) return `${compactFormatter.format(amount / 1e9)} tỷ`;
  if (amount >= 1e6) return `${compactFormatter.format(amount / 1e6)} triệu`;
  return formatVnd(amount);
}

export interface VnDateParts {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** "CN", "T2"… "T7" */
  weekday: (typeof WEEKDAYS)[number];
}

/** Tách ngày giờ theo giờ Việt Nam bằng phép cộng offset cố định (không phụ thuộc múi giờ máy). */
export function vnParts(iso: string): VnDateParts {
  const shifted = new Date(Date.parse(iso) + VN_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: WEEKDAYS[shifted.getUTCDay()] ?? "CN",
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "19:00" */
export function formatTime(iso: string): string {
  const p = vnParts(iso);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "19.12.2026" */
export function formatDate(iso: string): string {
  const p = vnParts(iso);
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}

/** "19.12" */
export function formatDayMonth(iso: string): string {
  const p = vnParts(iso);
  return `${pad(p.day)}.${pad(p.month)}`;
}

/** "T7 19.12.2026 · 19:00" */
export function formatDateTime(iso: string): string {
  return `${vnParts(iso).weekday} ${formatDate(iso)} · ${formatTime(iso)}`;
}

/** "19.12 10:00" (dùng cho mốc đợt bán). */
export function formatShortDateTime(iso: string): string {
  return `${formatDayMonth(iso)} ${formatTime(iso)}`;
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Thời gian còn lại tới `targetIso`; null khi đã qua mốc. */
export function countdownTo(targetIso: string, now: number): Countdown | null {
  const total = Math.floor((Date.parse(targetIso) - now) / 1000);
  if (total <= 0) return null;
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}
