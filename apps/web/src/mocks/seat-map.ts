import type { SeatMapLayout } from "@/lib/seatmap/layout";
import type { SeedEvent } from "./seed";

// Seed V-104 chưa có seat map (event-service sinh ở S-205), nên mock tự sinh layout từ `capacity`
// của các hạng SEATED: mỗi hạng một block (A, B… theo giá giảm dần), chia thành các khu A1, A2…
// ≤ 400 ghế, hàng ≤ 20 ghế. Trong hợp đồng, block là `zones[]` và khu là `zones[].blocks[]`. Đúng định dạng `seat_map.layout` của event-service; tổng số ghế bằng tổng capacity.

const MAX_BLOCK_SEATS = 400;
const MAX_ROW_SEATS = 20;

function rowLabel(index: number): string {
  // A…Z, rồi AA, AB…
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return index < 26
    ? (letters[index] ?? "A")
    : `${letters[Math.floor(index / 26) - 1] ?? "A"}${letters[index % 26] ?? "A"}`;
}

function split(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  return Array.from({ length: parts }, (_, i) => base + (i < total % parts ? 1 : 0));
}

export function mockSeatMapLayout(event: SeedEvent): SeatMapLayout | null {
  const seated = event.ticket_classes
    .filter((tc) => tc.kind === "SEATED")
    .sort((a, b) => b.price_vnd - a.price_vnd);
  if (seated.length === 0) return null;
  return {
    zones: seated.map((tc, zi) => {
      const letter = rowLabel(zi);
      const blockSizes = split(tc.capacity, Math.ceil(tc.capacity / MAX_BLOCK_SEATS));
      return {
        name: `Block ${letter}`,
        blocks: blockSizes.map((size, bi) => ({
          name: `${letter}${bi + 1}`,
          rows: split(size, Math.ceil(size / MAX_ROW_SEATS)).map((seats, ri) => ({
            label: rowLabel(ri),
            seats,
            ticket_class_id: tc.id,
          })),
        })),
      };
    }),
  };
}
