import { SEAT_SPACING, type SeatPoint } from "./geometry";

// Tra ghế gần con trỏ bằng lưới không gian (ô cỡ SEAT_SPACING): mỗi lần bấm chỉ xét 9 ô quanh
// điểm bấm thay vì duyệt 10k ghế, và không cần Konva dựng hit graph cho từng ghế.

const CELL = SEAT_SPACING;

export class SeatIndex {
  private readonly cells = new Map<string, number[]>();

  constructor(private readonly seats: SeatPoint[]) {
    seats.forEach((seat, i) => {
      const id = this.cellId(Math.floor(seat.x / CELL), Math.floor(seat.y / CELL));
      const bucket = this.cells.get(id);
      if (bucket) bucket.push(i);
      else this.cells.set(id, [i]);
    });
  }

  private cellId(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  /** Ghế có tâm gần (x, y) nhất trong bán kính `maxDistance` (điểm thế giới); null nếu không có. */
  nearest(x: number, y: number, maxDistance: number): SeatPoint | null {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    const reach = Math.max(1, Math.ceil(maxDistance / CELL));
    let best: SeatPoint | null = null;
    let bestDistance = maxDistance * maxDistance;
    for (let dx = -reach; dx <= reach; dx += 1) {
      for (let dy = -reach; dy <= reach; dy += 1) {
        for (const i of this.cells.get(this.cellId(cx + dx, cy + dy)) ?? []) {
          const seat = this.seats[i];
          if (!seat) continue;
          const d = (seat.x - x) ** 2 + (seat.y - y) ** 2;
          if (d <= bestDistance) {
            bestDistance = d;
            best = seat;
          }
        }
      }
    }
    return best;
  }
}
