import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import Konva from "konva";
import { SEAT_RADIUS, type Bounds, type SeatMapGeometry } from "@/lib/seatmap/geometry";
import { MAP_COLORS, textOn } from "@/lib/seatmap/colors";
import { SeatIndex } from "@/lib/seatmap/hit-test";
import type { SeatStatus } from "@/lib/seatmap/selection";

// Sơ đồ ghế trên canvas (Konva). 10k ghế nếu mỗi ghế là một node thì kéo/zoom chậm, nên mỗi block
// là MỘT Konva.Shape tự vẽ cả lô ghế (`sceneFunc`), tắt hit graph; bấm ghế tra bằng lưới không gian.
// Bảng sơ đồ luôn nền tối như wireframe V-105 `Seat-D`, ở cả hai theme.

const MIN_SCALE_FACTOR = 0.8;
const MAX_SCALE = 6;
/** Dưới mức phóng này vẽ ô vuông thay hình tròn (nhanh hơn, ở cỡ này mắt không phân biệt được). */
const DETAIL_SCALE = 0.6;
/** Bấm lệch tối đa bao nhiêu pixel màn hình vẫn tính là trúng ghế (vùng chạm ≥ 44px trên mobile). */
const TAP_SLOP_PX = 14;

export interface SeatMapHandle {
  zoomBy: (factor: number) => void;
  fit: () => void;
  focus: (bounds: Bounds) => void;
}

interface SeatMapCanvasProps {
  geometry: SeatMapGeometry;
  /** Màu theo hạng vé (ticket_class_id → màu). */
  classColors: ReadonlyMap<string, string>;
  statuses: ReadonlyMap<string, SeatStatus>;
  selected: ReadonlySet<string>;
  onSeatPress: (key: string) => void;
  /** Mô tả cho trình đọc màn hình (canvas không đọc được). */
  label: string;
  className?: string;
}

export const SeatMapCanvas = forwardRef<SeatMapHandle, SeatMapCanvasProps>(function SeatMapCanvas(
  { geometry, classColors, statuses, selected, onSeatPress, label, className },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const layerRef = useRef<Konva.Layer | null>(null);
  const minScaleRef = useRef(0.1);
  // Dữ liệu vẽ đọc qua ref để sceneFunc luôn thấy bản mới mà không phải dựng lại Stage.
  const drawState = useRef({ classColors, statuses, selected });
  const pressRef = useRef(onSeatPress);
  const handleRef = useRef<SeatMapHandle | null>(null);
  const gaShapesRef = useRef<
    { area: SeatMapGeometry["gaAreas"][number]; shape: Konva.Arc; text: Konva.Text }[]
  >([]);
  const index = useMemo(() => new SeatIndex(geometry.seats), [geometry]);

  // Đổi trạng thái/lựa chọn/màu: cập nhật dữ liệu vẽ rồi chỉ vẽ lại layer, không dựng lại Stage.
  useLayoutEffect(() => {
    drawState.current = { classColors, statuses, selected };
    for (const { area, shape, text } of gaShapesRef.current) {
      const color = classColors.get(area.ticketClassId) ?? MAP_COLORS.label;
      shape.fill(color);
      text.fill(textOn(color));
    }
    layerRef.current?.batchDraw();
  }, [classColors, statuses, selected]);
  useLayoutEffect(() => {
    pressRef.current = onSeatPress;
  }, [onSeatPress]);

  // Dựng Stage một lần cho mỗi geometry.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const stage = new Konva.Stage({
      container: host,
      width: host.clientWidth,
      height: host.clientHeight,
      draggable: true,
    });
    const layer = new Konva.Layer({ listening: false });
    stage.add(layer);
    stageRef.current = stage;
    layerRef.current = layer;

    // Sân khấu.
    const r = geometry.stageRadius;
    layer.add(
      new Konva.Arc({
        x: 0,
        y: 0,
        innerRadius: 0,
        outerRadius: r,
        angle: 180,
        rotation: 180,
        fill: MAP_COLORS.stage,
      }),
      new Konva.Text({
        x: -r,
        y: -r / 2.4,
        width: r * 2,
        align: "center",
        text: "Sân khấu",
        fontSize: r / 4.5,
        fontStyle: "800",
        fontFamily: "Bricolage Grotesque, system-ui, sans-serif",
        fill: MAP_COLORS.stageText,
      }),
    );

    // Khu đứng: mỗi khu một hình quạt liền màu hạng vé, tên khu ở giữa.
    // Konva.Arc đo góc theo chiều kim đồng hồ từ trục x; góc của geometry đo từ trục thẳng lên.
    const gaShapes = geometry.gaAreas.map((area) => {
      const color = drawState.current.classColors.get(area.ticketClassId) ?? MAP_COLORS.label;
      const fontSize = Math.min(16, Math.max(9, area.arcLength / 10));
      const shape = new Konva.Arc({
        x: 0,
        y: 0,
        innerRadius: area.innerRadius,
        outerRadius: area.outerRadius,
        rotation: -90 + (area.startAngle * 180) / Math.PI,
        angle: ((area.endAngle - area.startAngle) * 180) / Math.PI,
        fill: color,
      });
      const width = area.arcLength * 0.9;
      const text = new Konva.Text({
        x: area.center.x - width / 2,
        y: area.center.y - fontSize * 1.1,
        width,
        height: fontSize * 2.4,
        align: "center",
        verticalAlign: "middle",
        text: area.name,
        fontSize,
        fontStyle: "800",
        fontFamily: "Bricolage Grotesque, system-ui, sans-serif",
        fill: textOn(color),
        wrap: "word",
        ellipsis: true,
      });
      layer.add(shape, text);
      return { area, shape, text };
    });
    gaShapesRef.current = gaShapes;

    for (const block of geometry.blocks) {
      layer.add(
        new Konva.Shape({
          listening: false,
          perfectDrawEnabled: false,
          sceneFunc: (ctx) => {
            const { classColors: colors, statuses: status, selected: picked } = drawState.current;
            const detailed = stage.scaleX() >= DETAIL_SCALE;
            const c = ctx._context;
            for (let i = block.start; i < block.end; i += 1) {
              const seat = geometry.seats[i];
              if (!seat) continue;
              const state = status.get(seat.key);
              const isPicked = picked.has(seat.key);
              if (state === "held" && !isPicked) {
                // Người khác đang giữ: vòng rỗng như wireframe.
                c.beginPath();
                c.arc(seat.x, seat.y, SEAT_RADIUS - 1, 0, Math.PI * 2);
                c.strokeStyle = MAP_COLORS.held;
                c.lineWidth = 1.6;
                c.stroke();
                continue;
              }
              c.fillStyle = isPicked
                ? MAP_COLORS.selected
                : state === "sold"
                  ? MAP_COLORS.sold
                  : (colors.get(seat.ticketClassId) ?? MAP_COLORS.label);
              if (detailed) {
                c.beginPath();
                c.arc(seat.x, seat.y, isPicked ? SEAT_RADIUS + 0.8 : SEAT_RADIUS, 0, Math.PI * 2);
                c.fill();
              } else {
                const s = SEAT_RADIUS * 1.8;
                c.fillRect(seat.x - s / 2, seat.y - s / 2, s, s);
              }
            }
          },
        }),
      );
    }

    // Nhãn hàng: chỉ hiện khi đủ lớn để đọc.
    const labels = new Konva.Group({ visible: false });
    for (const rowLabel of geometry.rowLabels) {
      labels.add(
        new Konva.Text({
          x: rowLabel.x - 10,
          y: rowLabel.y - 5,
          width: 20,
          align: "center",
          text: rowLabel.text,
          fontSize: 8,
          fontStyle: "700",
          fontFamily: "Bricolage Grotesque, system-ui, sans-serif",
          fill: MAP_COLORS.label,
        }),
      );
    }
    layer.add(labels);

    const applyScale = (scale: number, anchor: { x: number; y: number }) => {
      const old = stage.scaleX();
      const next = Math.min(MAX_SCALE, Math.max(minScaleRef.current, scale));
      const world = { x: (anchor.x - stage.x()) / old, y: (anchor.y - stage.y()) / old };
      stage.scale({ x: next, y: next });
      stage.position({ x: anchor.x - world.x * next, y: anchor.y - world.y * next });
      labels.visible(next >= 1.2);
      layer.batchDraw();
    };

    const fitTo = (bounds: Bounds, padding: number) => {
      const w = stage.width();
      const h = stage.height();
      const bw = bounds.maxX - bounds.minX;
      const bh = bounds.maxY - bounds.minY;
      const scale = Math.min((w - padding * 2) / bw, (h - padding * 2) / bh);
      stage.scale({ x: scale, y: scale });
      stage.position({
        x: w / 2 - ((bounds.minX + bounds.maxX) / 2) * scale,
        y: h / 2 - ((bounds.minY + bounds.maxY) / 2) * scale,
      });
      labels.visible(scale >= 1.2);
      layer.batchDraw();
      return scale;
    };

    const fitAll = () => {
      const scale = fitTo(geometry.bounds, 16);
      minScaleRef.current = scale * MIN_SCALE_FACTOR;
    };
    fitAll();

    stage.on("wheel", (e) => {
      e.evt.preventDefault();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const factor = e.evt.deltaY > 0 ? 1 / 1.15 : 1.15;
      applyScale(stage.scaleX() * factor, pointer);
    });

    // Chụm hai ngón để phóng to trên màn hình cảm ứng.
    let pinchDistance = 0;
    stage.on("touchmove", (e) => {
      const [a, b] = e.evt.touches;
      if (!a || !b) return;
      e.evt.preventDefault();
      if (stage.isDragging()) stage.stopDrag();
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const rect = host.getBoundingClientRect();
      const center = {
        x: (a.clientX + b.clientX) / 2 - rect.left,
        y: (a.clientY + b.clientY) / 2 - rect.top,
      };
      if (pinchDistance > 0) applyScale((stage.scaleX() * distance) / pinchDistance, center);
      pinchDistance = distance;
    });
    stage.on("touchend", () => {
      pinchDistance = 0;
    });

    // Bấm (không kéo) mới tính là chọn ghế.
    stage.on("click tap", () => {
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const scale = stage.scaleX();
      const world = { x: (pointer.x - stage.x()) / scale, y: (pointer.y - stage.y()) / scale };
      const seat = index.nearest(world.x, world.y, Math.max(SEAT_RADIUS, TAP_SLOP_PX / scale));
      if (seat) pressRef.current(seat.key);
    });

    const resize = new ResizeObserver(() => {
      stage.size({ width: host.clientWidth, height: host.clientHeight });
      fitAll();
    });
    resize.observe(host);

    handleRef.current = {
      zoomBy: (factor) =>
        applyScale(stage.scaleX() * factor, { x: stage.width() / 2, y: stage.height() / 2 }),
      fit: fitAll,
      focus: (bounds) => {
        fitTo(bounds, 24);
      },
    };

    return () => {
      resize.disconnect();
      stage.destroy();
      stageRef.current = null;
      layerRef.current = null;
      gaShapesRef.current = [];
      handleRef.current = null;
    };
  }, [geometry, index]);

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (factor) => handleRef.current?.zoomBy(factor),
      fit: () => handleRef.current?.fit(),
      focus: (bounds) => handleRef.current?.focus(bounds),
    }),
    [],
  );

  return (
    <div
      ref={hostRef}
      role="img"
      aria-label={label}
      className={className}
      style={{ touchAction: "none", background: MAP_COLORS.background }}
    />
  );
});
