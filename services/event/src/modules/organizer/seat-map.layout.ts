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
const gaArea = z.object({ name, ticket_class_id: z.string().uuid() }).strict();
const layoutSchema = z
  .object({
    zones: z.array(zone).max(100),
    ga_areas: z.array(gaArea).max(100).optional(),
  })
  .strict()
  .refine((value) => value.zones.length > 0 || (value.ga_areas?.length ?? 0) > 0);

export type SeatMapLayout = z.infer<typeof layoutSchema>;

export function parseSeatMapLayout(value: unknown): { layout: SeatMapLayout; seatCount: number } {
  const parsed = layoutSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProblemException("INVALID_SEAT_MAP", 400, "Layout seat map không hợp lệ");
  }
  const layout = parsed.data;
  const zoneNames = new Set<string>();
  let seatCount = 0;
  const gaClassIds = new Set<string>();
  for (const area of layout.ga_areas ?? []) {
    // Zone và khu đứng dùng chung một không gian tên để khán giả không nhầm lẫn khi chọn khu.
    if (zoneNames.has(area.name)) throw duplicateLayout();
    zoneNames.add(area.name);
    if (gaClassIds.has(area.ticket_class_id)) {
      throw new ProblemException(
        "DUPLICATE_GA_CLASS",
        400,
        "Mỗi hạng vé GA chỉ gắn với một khu đứng",
      );
    }
    gaClassIds.add(area.ticket_class_id);
  }
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

export function gaClassIdsOf(layout: SeatMapLayout): string[] {
  return (layout.ga_areas ?? []).map((area) => area.ticket_class_id);
}

function duplicateLayout() {
  return new ProblemException(
    "DUPLICATE_SEAT_MAP_LABEL",
    400,
    "Tên zone, khu đứng, block hoặc row bị trùng",
  );
}
