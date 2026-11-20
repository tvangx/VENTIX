import { z } from "zod";

// Layout seat map công khai của event-service (`seat_map.layout`). OpenAPI chỉ khai báo là object
// tự do, nên parse lại theo đúng ràng buộc của services/event/.../seat-map.layout.ts.

const name = z.string().trim().min(1).max(128);
const RowSchema = z.object({
  label: z.string().trim().min(1).max(16),
  seats: z.number().int().min(1).max(1000),
  ticket_class_id: z.string().uuid(),
});
const BlockSchema = z.object({ name, rows: z.array(RowSchema).min(1).max(200) });
const ZoneSchema = z.object({ name, blocks: z.array(BlockSchema).min(1).max(100) });
export const SeatMapLayoutSchema = z.object({ zones: z.array(ZoneSchema).min(1).max(100) });

export type SeatMapLayout = z.infer<typeof SeatMapLayoutSchema>;

/** null khi layout sai dạng (UI báo "chưa có sơ đồ" thay vì vỡ trang). */
export function parseLayout(value: unknown): SeatMapLayout | null {
  const parsed = SeatMapLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
