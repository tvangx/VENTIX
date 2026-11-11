import { ProblemException } from "@ticketing/common";
import { z } from "zod";

const name = z.string().trim().min(1).max(128);
const row = z
  .object({
    label: z.string().trim().min(1).max(16),
    seats: z.number().int().min(1).max(1000),
    ticket_class_id: z.string().uuid(),
  })
  .strict();
const block = z.object({ name, rows: z.array(row).min(1).max(200) }).strict();
const zone = z.object({ name, blocks: z.array(block).min(1).max(100) }).strict();
const layoutSchema = z.object({ zones: z.array(zone).min(1).max(100) }).strict();

export type SeatMapLayout = z.infer<typeof layoutSchema>;

export function parseSeatMapLayout(value: unknown): { layout: SeatMapLayout; seatCount: number } {
  const parsed = layoutSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProblemException("INVALID_SEAT_MAP", 400, "Layout seat map không hợp lệ");
  }
  const layout = parsed.data;
  const zoneNames = new Set<string>();
  let seatCount = 0;
  for (const zone of layout.zones) {
    if (zoneNames.has(zone.name)) throw duplicateLayout();
    zoneNames.add(zone.name);
    const blockNames = new Set<string>();
    for (const block of zone.blocks) {
      if (blockNames.has(block.name)) throw duplicateLayout();
      blockNames.add(block.name);
      const rowLabels = new Set<string>();
      for (const row of block.rows) {
        if (rowLabels.has(row.label)) throw duplicateLayout();
        rowLabels.add(row.label);
        seatCount += row.seats;
        if (seatCount > 100000) {
          throw new ProblemException("SEAT_MAP_TOO_LARGE", 400, "Seat map vượt 100.000 ghế");
        }
      }
    }
  }
  return { layout, seatCount };
}

function duplicateLayout() {
  return new ProblemException("DUPLICATE_SEAT_MAP_LABEL", 400, "Tên zone, block hoặc row bị trùng");
}
