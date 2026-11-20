import type { TierTone } from "@/lib/catalog/sale";

// Màu canvas phải là giá trị cụ thể (không đọc được class Tailwind). Bảng sơ đồ luôn nền tối như
// wireframe V-105 `Seat-D`, nên dùng một bộ màu cho cả hai theme; giá trị khớp token trong styles.css.

export const MAP_COLORS = {
  background: "#27272a",
  stage: "#f4f4f5",
  stageText: "#1c1c20",
  label: "#a1a1aa",
  sold: "#3f3f46",
  held: "#2dc275",
  selected: "#ffffff",
} as const;

/** Màu hạng vé (`--tier-1..4`): SVIP xanh lá nhạt, VIP xanh lá đậm, Standard xanh lá, Economy xám. */
export const TIER_COLORS: Record<TierTone, string> = {
  1: "#a7e8c5",
  2: "#11804a",
  3: "#2dc275",
  4: "#a1a1aa",
};
