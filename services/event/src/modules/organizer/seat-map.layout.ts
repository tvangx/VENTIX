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
const MAX_CANVAS = 10000;
const length = z.number().positive().max(MAX_CANVAS);
const coordinate = z.number().min(0).max(MAX_CANVAS);
const canvas = z.object({ width: length, height: length }).strict();
const boxPlacement = z
  .object({
    shape: z.enum(["rect", "ellipse"]),
    x: coordinate,
    y: coordinate,
    width: length,
    height: length,
    rotation: z.number().min(-360).max(360).optional(),
  })
  .strict();
const point = z.tuple([coordinate, coordinate]);
const polygonPlacement = z
  .object({ shape: z.object({ polygon: z.array(point).min(3).max(50) }).strict() })
  .strict();
const placement = z.union([boxPlacement, polygonPlacement]);
const block = z
  .object({ name, rows: z.array(row).min(1).max(200), position: placement.optional() })
  .strict();
const zone = z.object({ name, blocks: z.array(block).min(1).max(100) }).strict();
const gaArea = z
  .object({ name, ticket_class_id: z.string().uuid(), position: placement.optional() })
  .strict();
const layoutSchema = z
  .object({
    canvas: canvas.optional(),
    stage: placement.optional(),
    zones: z.array(zone).max(100),
    ga_areas: z.array(gaArea).max(100).optional(),
  })
  .strict()
  .refine((value) => value.zones.length > 0 || (value.ga_areas?.length ?? 0) > 0);

export type SeatMapLayout = z.infer<typeof layoutSchema>;
type Canvas = z.infer<typeof canvas>;
type Placement = z.infer<typeof placement>;
const PLACEMENT_KEYS = new Set<string | number>(["canvas", "stage", "position"]);

export function parseSeatMapLayout(value: unknown): { layout: SeatMapLayout; seatCount: number } {
  const parsed = layoutSchema.safeParse(value);
  if (!parsed.success) {
    if (parsed.error.issues.every((issue) => issue.path.some((key) => PLACEMENT_KEYS.has(key)))) {
      throw invalidPlacement();
    }
    throw new ProblemException("INVALID_SEAT_MAP", 400, "Layout seat map không hợp lệ");
  }
  const layout = parsed.data;
  checkPlacements(layout);
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

/** Vị trí không bắt buộc, nhưng đã đặt thì phải đặt hết mọi Khu và khu đứng. */
function checkPlacements(layout: SeatMapLayout) {
  const areas = [...layout.zones.flatMap((zone) => zone.blocks), ...(layout.ga_areas ?? [])];
  const positions = areas.flatMap((area) => (area.position ? [area.position] : []));
  if (positions.length > 0 && positions.length < areas.length) {
    throw new ProblemException(
      "PARTIAL_PLACEMENT",
      400,
      "Phải đặt vị trí cho tất cả Khu và khu đứng, hoặc không đặt cái nào",
    );
  }
  const placements = layout.stage ? [layout.stage, ...positions] : positions;
  const bounds = layout.canvas;
  if (placements.length === 0) return;
  if (!bounds || placements.some((item) => !fitsCanvas(item, bounds))) throw invalidPlacement();
}

// rect/ellipse chỉ kiểm khung trước khi xoay: góc khung sau khi xoay được phép ra ngoài canvas.
function fitsCanvas(item: Placement, bounds: Canvas) {
  if ("x" in item) {
    return item.x + item.width <= bounds.width && item.y + item.height <= bounds.height;
  }
  return item.shape.polygon.every(([x, y]) => x <= bounds.width && y <= bounds.height);
}

function invalidPlacement() {
  return new ProblemException(
    "INVALID_PLACEMENT",
    400,
    "Canvas hoặc vị trí, hình dạng trên sơ đồ không hợp lệ",
  );
}

function duplicateLayout() {
  return new ProblemException(
    "DUPLICATE_SEAT_MAP_LABEL",
    400,
    "Tên zone, khu đứng, block hoặc row bị trùng",
  );
}
