import type { SeatMapLayout } from "./layout";

// Dàn layout (block → khu → hàng → số ghế, không có tọa độ) thành sơ đồ vòng cung quanh sân khấu,
// giống wireframe V-105 `Seat-D`. Đơn vị là "điểm thế giới"; canvas tự co giãn khi hiển thị.
//
// - Sân khấu nằm dưới, tâm cung là (0, 0); trục y hướng xuống nên ghế có y âm.
// - Tên gọi trên UI: hợp đồng `zones[]` là Block (A, B…), `zones[].blocks[]` là Khu (B1, B2…).
//   Trong code giữ tên trường của hợp đồng: `zone` = Block, `block` = Khu.
// - Mỗi Block là một dải cung; Block đầu tiên gần sân khấu nhất.
// - Các Khu của một Block xếp cạnh nhau trên cung, cách nhau một khoảng trống.
// - Hàng đầu tiên của Khu gần sân khấu nhất; ghế số 1 ở bên trái nhìn từ khán đài.

export const SEAT_SPACING = 12;
export const ROW_SPACING = 14;
export const SEAT_RADIUS = 4.5;
const BLOCK_GAP = 28;
const ZONE_GAP = 40;
const STAGE_RADIUS = 90;
/** Góc tối đa một Block được trải ra (radian); Block rộng hơn thì bán kính tăng lên. */
const MAX_SPAN = (Math.PI * 160) / 180;

export interface SeatPoint {
  /** Khóa duy nhất theo vị trí: "block:khu:hàng:số" (tức zone:block của hợp đồng) (chỉ số, bắt đầu từ 0, trừ số ghế). */
  key: string;
  x: number;
  y: number;
  zone: number;
  block: number;
  row: number;
  seatNo: number;
  rowLabel: string;
  ticketClassId: string;
}

export interface BlockGeometry {
  zone: number;
  block: number;
  name: string;
  /** Chỉ số ghế trong `seats` của block này: [start, end). */
  start: number;
  end: number;
  bounds: Bounds;
}

export interface ZoneGeometry {
  index: number;
  name: string;
  bounds: Bounds;
  seatCount: number;
}

export interface RowLabel {
  text: string;
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SeatMapGeometry {
  seats: SeatPoint[];
  blocks: BlockGeometry[];
  zones: ZoneGeometry[];
  rowLabels: RowLabel[];
  bounds: Bounds;
  stageRadius: number;
}

export function seatKey(zone: number, block: number, row: number, seatNo: number): string {
  return `${zone}:${block}:${row}:${seatNo}`;
}

function emptyBounds(): Bounds {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

function extend(bounds: Bounds, x: number, y: number, pad = 0): void {
  bounds.minX = Math.min(bounds.minX, x - pad);
  bounds.minY = Math.min(bounds.minY, y - pad);
  bounds.maxX = Math.max(bounds.maxX, x + pad);
  bounds.maxY = Math.max(bounds.maxY, y + pad);
}

/** Điểm trên cung tâm (0,0): góc 0 là thẳng lên trên, góc âm lệch sang trái. */
function onArc(radius: number, angle: number): [number, number] {
  return [radius * Math.sin(angle), -radius * Math.cos(angle)];
}

export function buildGeometry(layout: SeatMapLayout): SeatMapGeometry {
  const seats: SeatPoint[] = [];
  const blocks: BlockGeometry[] = [];
  const zones: ZoneGeometry[] = [];
  const rowLabels: RowLabel[] = [];
  const all = emptyBounds();
  extend(all, -STAGE_RADIUS, 0);
  extend(all, STAGE_RADIUS, 0);
  let innerRadius = STAGE_RADIUS + ZONE_GAP;

  layout.zones.forEach((zone, zi) => {
    // Bề rộng (theo cung, tính ở bán kính trong) của từng block = hàng dài nhất.
    const widths = zone.blocks.map(
      (block) => Math.max(...block.rows.map((row) => row.seats)) * SEAT_SPACING,
    );
    const total = widths.reduce((sum, w) => sum + w, 0) + BLOCK_GAP * (zone.blocks.length - 1);
    // Không để Block trải quá MAX_SPAN: tăng bán kính trong nếu cần.
    const radius = Math.max(innerRadius, total / MAX_SPAN);
    const depth = Math.max(...zone.blocks.map((block) => block.rows.length)) * ROW_SPACING;
    const zoneBounds = emptyBounds();
    let cursor = -total / 2;
    let zoneSeats = 0;

    zone.blocks.forEach((block, bi) => {
      const width = widths[bi] ?? 0;
      const centerArc = cursor + width / 2;
      cursor += width + BLOCK_GAP;
      const blockBounds = emptyBounds();
      const start = seats.length;
      block.rows.forEach((row, ri) => {
        const r = radius + ri * ROW_SPACING;
        // Giữ khoảng cách ghế cố định theo chiều dài cung, căn giữa trong block.
        const centerAngle = centerArc / radius;
        const step = SEAT_SPACING / r;
        const first = centerAngle - ((row.seats - 1) * step) / 2;
        for (let n = 1; n <= row.seats; n += 1) {
          const [x, y] = onArc(r, first + (n - 1) * step);
          seats.push({
            key: seatKey(zi, bi, ri, n),
            x,
            y,
            zone: zi,
            block: bi,
            row: ri,
            seatNo: n,
            rowLabel: row.label,
            ticketClassId: row.ticket_class_id,
          });
          extend(blockBounds, x, y, SEAT_RADIUS);
        }
        // Nhãn hàng đặt bên trái ghế số 1 của Khu đầu Block, để không chen giữa các Khu.
        if (bi === 0) {
          const [lx, ly] = onArc(r, first - 1.6 * step);
          rowLabels.push({ text: row.label, x: lx, y: ly });
        }
        zoneSeats += row.seats;
      });
      blocks.push({
        zone: zi,
        block: bi,
        name: block.name,
        start,
        end: seats.length,
        bounds: blockBounds,
      });
      extend(zoneBounds, blockBounds.minX, blockBounds.minY);
      extend(zoneBounds, blockBounds.maxX, blockBounds.maxY);
    });

    zones.push({ index: zi, name: zone.name, bounds: zoneBounds, seatCount: zoneSeats });
    extend(all, zoneBounds.minX, zoneBounds.minY);
    extend(all, zoneBounds.maxX, zoneBounds.maxY);
    innerRadius = radius + depth + ZONE_GAP;
  });

  return { seats, blocks, zones, rowLabels, bounds: all, stageRadius: STAGE_RADIUS };
}
