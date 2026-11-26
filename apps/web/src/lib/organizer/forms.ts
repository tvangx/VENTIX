import { z } from "zod";
import { VN_OFFSET_MS } from "@/lib/catalog/format";

// Form của wizard. Organizer nhập giờ Việt Nam (ô datetime-local, không có múi giờ); API nhận UTC.
// Ràng buộc lấy theo DTO của event-service (organizer.dto.ts), thêm vài kiểm tra chỉ ở giao diện.

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "2027-03-13T20:00" (giờ Việt Nam) → "2027-03-13T13:00:00.000Z"; null khi sai dạng. */
export function vnLocalToUtc(local: string): string | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const utc = Date.UTC(y, mo - 1, d, h, mi) - VN_OFFSET_MS;
  const check = new Date(utc + VN_OFFSET_MS);
  // Ngày không tồn tại (31.02) bị Date tự đẩy sang tháng sau: coi là sai.
  if (check.getUTCDate() !== d || check.getUTCMonth() !== mo - 1) return null;
  return new Date(utc).toISOString();
}

/** UTC ISO → giá trị cho ô datetime-local theo giờ Việt Nam. */
export function utcToVnLocal(iso: string): string {
  return new Date(Date.parse(iso) + VN_OFFSET_MS).toISOString().slice(0, 16);
}

const text = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `Nhập ${label}`)
    .max(max, `${label[0]?.toUpperCase() ?? ""}${label.slice(1)} tối đa ${max} ký tự`);

const localTime = (label: string) =>
  z
    .string()
    .min(1, `Chọn ${label}`)
    .refine((value) => vnLocalToUtc(value) !== null, `${label} không hợp lệ`);

/** Số nguyên dương nhập dạng chuỗi ("5.000" hoặc "5000"). */
export function parseIntegerInput(value: string): number | null {
  const digits = value.replace(/[.\s]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : null;
}

const integer = (label: string, min: number, max: number) =>
  z.string().transform((value, ctx) => {
    const n = parseIntegerInput(value);
    if (n === null || n < min || n > max) {
      ctx.addIssue({
        code: "custom",
        message:
          n === null
            ? `${label} phải là số nguyên`
            : `${label} từ ${min.toLocaleString("vi-VN")} đến ${max.toLocaleString("vi-VN")}`,
      });
      return z.NEVER;
    }
    return n;
  });

export const INT32_MAX = 2147483647;

export const VenueFormSchema = z.object({
  name: text(255, "tên địa điểm"),
  address: text(512, "địa chỉ"),
  capacity: integer("Sức chứa", 1, INT32_MAX),
});
export type VenueForm = z.input<typeof VenueFormSchema>;

export const EventInfoSchema = z
  .object({
    venue_id: z.string().uuid("Chọn địa điểm"),
    title: text(255, "tên sự kiện"),
    description: z.string().max(10000, "Mô tả tối đa 10.000 ký tự"),
    start_local: localTime("Giờ bắt đầu"),
    end_local: localTime("Giờ kết thúc"),
  })
  .refine((v) => (vnLocalToUtc(v.start_local) ?? "") < (vnLocalToUtc(v.end_local) ?? ""), {
    path: ["end_local"],
    message: "Giờ kết thúc phải sau giờ bắt đầu",
  });
export type EventInfoForm = z.input<typeof EventInfoSchema>;

export const TicketClassSchema = z.object({
  name: text(128, "tên hạng"),
  kind: z.enum(["GA", "SEATED"]),
  price_vnd: integer("Giá", 0, Number.MAX_SAFE_INTEGER),
  capacity: integer("Số lượng", 1, INT32_MAX),
});
export type TicketClassForm = z.input<typeof TicketClassSchema>;

/**
 * Đợt mở bán. Ngoài ràng buộc của API (bắt đầu < kết thúc, số > 0), giao diện đòi đợt bán kết thúc
 * trước giờ diễn (giả định trong run report V-203).
 */
export function salePhaseSchema(eventStartIso: string) {
  return z
    .object({
      starts_local: localTime("Giờ mở bán"),
      ends_local: localTime("Giờ đóng bán"),
      per_user_limit: integer("Giới hạn mỗi người", 1, INT32_MAX),
      queue_enabled: z.boolean(),
      admit_rate: integer("Tốc độ cho vào", 1, INT32_MAX),
      require_kyc: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const start = vnLocalToUtc(v.starts_local);
      const end = vnLocalToUtc(v.ends_local);
      if (!start || !end) return;
      if (start >= end) {
        ctx.addIssue({
          code: "custom",
          path: ["ends_local"],
          message: "Giờ đóng bán phải sau giờ mở bán",
        });
      } else if (Date.parse(end) > Date.parse(eventStartIso)) {
        ctx.addIssue({
          code: "custom",
          path: ["ends_local"],
          message: "Đợt bán phải kết thúc trước giờ diễn",
        });
      }
    });
}
export type SalePhaseForm = z.input<ReturnType<typeof salePhaseSchema>>;

/** Lỗi zod → { tên trường: thông báo đầu tiên }. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
