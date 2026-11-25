import { z } from "zod";

// Layout seat map của event-service (`seat_map.layout`). OpenAPI chỉ khai báo là object tự do,
// nên parse lại theo đúng ràng buộc của services/event/.../seat-map.layout.ts.
// Issue #98: layout có thêm `ga_areas` (khu đứng, không có ghế); `zones` được phép rỗng nếu có
// khu đứng (sự kiện toàn vé đứng).

const name = z.string().trim().min(1).max(128);
const RowSchema = z.object({
  label: z.string().trim().min(1).max(16),
  seats: z.number().int().min(1).max(1000),
  ticket_class_id: z.string().uuid(),
});
const BlockSchema = z.object({ name, rows: z.array(RowSchema).min(1).max(200) });
const ZoneSchema = z.object({ name, blocks: z.array(BlockSchema).min(1).max(100) });
export const GaAreaSchema = z.object({ name, ticket_class_id: z.string().uuid() });
const GaAreasSchema = z.array(GaAreaSchema).max(100).optional();

/** Layout có ghế: dùng cho viewer/chọn ghế, cần ít nhất một zone. */
export const SeatMapLayoutSchema = z.object({
  zones: z.array(ZoneSchema).min(1).max(100),
  ga_areas: GaAreasSchema,
});

/** Layout đúng hợp đồng: zone có thể rỗng nếu có khu đứng (dùng ở khu organizer). */
export const AnySeatMapLayoutSchema = z
  .object({ zones: z.array(ZoneSchema).max(100), ga_areas: GaAreasSchema })
  .refine((value) => value.zones.length > 0 || (value.ga_areas?.length ?? 0) > 0);

export type SeatMapLayout = z.infer<typeof AnySeatMapLayoutSchema>;
export type GaArea = z.infer<typeof GaAreaSchema>;

/** null khi layout sai dạng hoặc không có ghế (UI báo "chưa có sơ đồ" thay vì vỡ trang). */
export function parseLayout(value: unknown): SeatMapLayout | null {
  const parsed = SeatMapLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Như `parseLayout` nhưng nhận cả layout chỉ có khu đứng. */
export function parseAnyLayout(value: unknown): SeatMapLayout | null {
  const parsed = AnySeatMapLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
