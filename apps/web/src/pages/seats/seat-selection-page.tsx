import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import { SeatMapCanvas, type SeatMapHandle } from "@/components/seat-map/seat-map-canvas";
import { Button } from "@/components/ui/button";
import { toProblem } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatDayMonth, formatTime, formatVnd } from "@/lib/catalog/format";
import { useEventDetail, useNow } from "@/lib/catalog/queries";
import { saleStateOf, tierTones, type CatalogDetail, type TierTone } from "@/lib/catalog/sale";
import { MAP_COLORS, TIER_COLORS } from "@/lib/seatmap/colors";
import { buildGeometry, type SeatMapGeometry, type SeatPoint } from "@/lib/seatmap/geometry";
import { parseLayout, type SeatMapLayout } from "@/lib/seatmap/layout";
import { toggleSeat, TOGGLE_MESSAGES, type SeatStatus } from "@/lib/seatmap/selection";

const TONE_CLASS: Record<TierTone, string> = {
  1: "bg-tier-1 text-tier-1-foreground",
  2: "bg-tier-2 text-tier-2-foreground",
  3: "bg-tier-3 text-tier-3-foreground",
  4: "bg-tier-4 text-tier-4-foreground",
};
// Trạng thái ghế (đã bán/đang giữ) do V-301 nối từ booking; V-202 chưa có nguồn nên để trống.
const NO_STATUS: ReadonlyMap<string, SeatStatus> = new Map();

/** Trang chọn ghế (V-105 `Seat-D`/`Seat-M`): sơ đồ Konva, chọn ghế phía client, chưa giữ ghế. */
export function SeatSelectionPage() {
  const { id = "" } = useParams();
  const detail = useEventDetail(id);

  if (detail.isPending) {
    return (
      <p role="status" className="mx-auto max-w-[1312px] px-4 py-16 text-lg md:px-8 xl:px-16">
        Đang tải sơ đồ ghế…
      </p>
    );
  }
  if (detail.isError) {
    const status = toProblem(detail.error)?.status;
    return (
      <Notice
        title={status === 404 || status === 400 ? "Không tìm thấy" : "Lỗi tải"}
        message={
          status === 404 || status === 400
            ? "Lỗi: sự kiện không tồn tại hoặc chưa được công khai."
            : "Lỗi: chưa tải được sơ đồ ghế. Thử lại sau ít phút."
        }
        back={{ to: "/explore", label: "Xem sự kiện khác" }}
        onRetry={status === 404 || status === 400 ? undefined : () => void detail.refetch()}
      />
    );
  }
  const event = detail.data;
  const layout = parseLayout(event.seat_map?.layout);
  if (!layout) {
    const standing = event.ticket_classes.every((tc) => tc.kind === "GA");
    return (
      <Notice
        title={standing ? "Không cần" : "Chưa có"}
        emphasis={standing ? "chọn ghế" : "sơ đồ ghế"}
        message={
          standing
            ? "Sự kiện này bán vé đứng, không cần chọn ghế."
            : "Sự kiện này chưa có sơ đồ ghế. Quay lại sau nhé."
        }
        back={{ to: `/events/${event.id}`, label: "Về trang sự kiện" }}
      />
    );
  }
  return <SeatSelection event={event} layout={layout} />;
}

function SeatSelection({ event, layout }: { event: CatalogDetail; layout: SeatMapLayout }) {
  const geometry = useMemo(() => buildGeometry(layout), [layout]);
  const seatsByKey = useMemo(
    () => new Map(geometry.seats.map((seat) => [seat.key, seat])),
    [geometry],
  );
  const classes = useMemo(
    () => new Map(event.ticket_classes.map((tc) => [tc.id, tc])),
    [event.ticket_classes],
  );
  const tones = useMemo(() => tierTones(event.ticket_classes), [event.ticket_classes]);
  const classColors = useMemo(
    () => new Map([...tones].map(([classId, tone]) => [classId, TIER_COLORS[tone]])),
    [tones],
  );
  const now = useNow(30_000);
  const sale = saleStateOf(event.sale_phases, now);
  const limit = sale.status === "ON_SALE" ? (sale.phase?.per_user_limit ?? 0) : 0;

  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<number | null>(null);
  const mapRef = useRef<SeatMapHandle>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const press = useCallback(
    (key: string) => {
      const result = toggleSeat(selected, key, limit, NO_STATUS);
      if (result.ok) {
        setSelected(result.selected);
        setMessage(null);
      } else {
        setMessage(TOGGLE_MESSAGES[result.reason]);
      }
    },
    [selected, limit],
  );

  const picked = selected
    .map((key) => seatsByKey.get(key))
    .filter((seat): seat is SeatPoint => seat !== undefined);
  const total = picked.reduce(
    (sum, seat) => sum + (classes.get(seat.ticketClassId)?.price_vnd ?? 0),
    0,
  );
  const zoneTone = (zone: number): TierTone => {
    const classId = layout.zones[zone]?.blocks[0]?.rows[0]?.ticket_class_id;
    return (classId && tones.get(classId)) || 4;
  };
  const seatName = (seat: SeatPoint) => `${seat.rowLabel}${seat.seatNo}`;
  const seatPlace = (seat: SeatPoint) => {
    const zone = layout.zones[seat.zone];
    return `${classes.get(seat.ticketClassId)?.name ?? ""} · ${zone?.name ?? ""} · Khu ${
      zone?.blocks[seat.block]?.name ?? ""
    }`;
  };
  const legendClasses = [...event.ticket_classes]
    .filter((tc) => tc.kind === "SEATED")
    .sort((a, b) => b.price_vnd - a.price_vnd);

  return (
    <div className="bg-[#1c1c20] text-[#f4f4f5]">
      <div className="mx-auto flex max-w-[1312px] flex-col gap-6 px-4 py-6 md:px-8 md:py-10 xl:px-16">
        <div className="flex flex-wrap items-center justify-between gap-3 text-[15px] font-semibold md:text-[17px]">
          <span>
            {event.title} · {formatDayMonth(event.start_at)} {formatTime(event.start_at)} ·{" "}
            <span className="font-serif font-medium italic">{event.venue.name}</span>
          </span>
          <Link
            to={`/events/${event.id}`}
            className="rounded-md underline-offset-4 outline-none hover:underline focus-visible:ring-4 focus-visible:ring-[#2dc275]"
          >
            Thoát
          </Link>
        </div>

        <div className="flex flex-wrap gap-8 lg:gap-10">
          <main className="flex min-w-0 flex-[999_1_640px] flex-col gap-4">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h1 className="m-0 text-5xl leading-[0.88] font-extrabold tracking-[-0.055em] md:text-7xl">
                Chọn <span className="font-serif font-medium text-[#2dc275] italic">chỗ ngồi</span>
              </h1>
              <div
                role="group"
                aria-label="Block"
                className="flex max-w-full gap-2 overflow-x-auto pb-1"
              >
                {geometry.zones.map((zone) => (
                  <button
                    key={zone.index}
                    type="button"
                    aria-pressed={activeZone === zone.index}
                    onClick={() => {
                      setActiveZone(zone.index);
                      mapRef.current?.focus(zone.bounds);
                    }}
                    className={cn(
                      "h-11 shrink-0 cursor-pointer rounded-full px-4 text-[15px] font-bold whitespace-nowrap outline-none focus-visible:ring-4 focus-visible:ring-white",
                      TONE_CLASS[zoneTone(zone.index)],
                      activeZone === zone.index && "ring-[3px] ring-[#f4f4f5]",
                    )}
                  >
                    {zone.name} · {zoneClassName(layout, zone.index, classes)}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative h-[420px] overflow-hidden rounded-[24px] md:h-[560px] md:rounded-[28px]">
              <SeatMapCanvas
                ref={mapRef}
                geometry={geometry}
                classColors={classColors}
                statuses={NO_STATUS}
                selected={selectedSet}
                onSeatPress={press}
                label={`Sơ đồ ${geometry.seats.length.toLocaleString("vi-VN")} ghế, ${geometry.zones.length} block. Dùng bộ chọn ghế bên dưới nếu không dùng chuột hoặc cảm ứng.`}
                className="size-full"
              />
              <span className="pointer-events-none absolute top-3 left-3 max-w-[calc(100%-5rem)] rounded-[14px] bg-[#1c1c20] px-3 py-1.5 text-xs">
                Kéo để di chuyển · lăn chuột hoặc chụm hai ngón để phóng to
              </span>
              <div className="absolute top-3 right-3 flex flex-col gap-1.5">
                <MapButton label="Phóng to" onClick={() => mapRef.current?.zoomBy(1.4)}>
                  <Plus aria-hidden="true" className="size-5" />
                </MapButton>
                <MapButton label="Thu nhỏ" onClick={() => mapRef.current?.zoomBy(1 / 1.4)}>
                  <Minus aria-hidden="true" className="size-5" />
                </MapButton>
                <MapButton
                  label="Xem toàn bộ sơ đồ"
                  onClick={() => {
                    setActiveZone(null);
                    mapRef.current?.fit();
                  }}
                >
                  <Maximize2 aria-hidden="true" className="size-4" />
                </MapButton>
              </div>
            </div>

            <ul
              aria-label="Chú thích"
              className="m-0 flex list-none flex-wrap items-center gap-x-5 gap-y-2 p-0 text-[15px]"
            >
              {legendClasses.map((tc) => (
                <li key={tc.id} className="inline-flex items-center gap-2">
                  <Dot color={classColors.get(tc.id) ?? MAP_COLORS.label} />
                  {tc.name} · {formatVnd(tc.price_vnd)}
                </li>
              ))}
              <li className="inline-flex items-center gap-2">
                <Dot color={MAP_COLORS.selected} />
                Bạn chọn
              </li>
              <li className="inline-flex items-center gap-2">
                <span className="size-3 rounded-full border-[3px] border-[#2dc275]" />
                Người khác đang giữ
              </li>
              <li className="inline-flex items-center gap-2">
                <Dot color={MAP_COLORS.sold} />
                Đã bán
              </li>
            </ul>

            <KeyboardPicker
              geometry={geometry}
              layout={layout}
              onAdd={(key) =>
                selected.includes(key) ? setMessage("Bạn đã chọn ghế này rồi.") : press(key)
              }
              disabled={limit === 0}
            />
          </main>

          <aside className="flex flex-[1_1_300px] flex-col gap-5 self-start">
            <section aria-labelledby="your-seats" className="-rotate-1 bg-[#f4f4f5] text-[#1c1c20]">
              <div className="px-6 pt-6 pb-4">
                <h2 id="your-seats" className="m-0 text-3xl font-extrabold tracking-[-0.03em]">
                  Ghế <span className="font-serif font-medium text-[#11804a] italic">của bạn</span>
                </h2>
                <span className="text-[15px]">
                  {limit > 0
                    ? `${picked.length} / ${limit} ghế · giới hạn của đợt mở bán`
                    : "Chưa mở bán, chưa chọn ghế được"}
                </span>
              </div>
              <div aria-hidden="true" className="relative h-0">
                <div className="absolute inset-x-5 -top-px border-t-[3px] border-dashed border-[#1c1c20]" />
                <div className="absolute -top-3.5 -left-3.5 size-7 rounded-full bg-[#1c1c20]" />
                <div className="absolute -top-3.5 -right-3.5 size-7 rounded-full bg-[#1c1c20]" />
              </div>
              <div className="flex flex-col gap-3 px-6 pt-5 pb-6">
                {picked.length === 0 ? (
                  <p className="m-0 text-base leading-normal">
                    Chạm vào chấm màu trên sơ đồ hoặc dùng bộ chọn ghế để chọn.
                  </p>
                ) : (
                  <ul aria-label="Ghế đã chọn" className="m-0 flex list-none flex-col gap-2 p-0">
                    {picked.map((seat) => (
                      <li
                        key={seat.key}
                        className="flex items-center justify-between gap-3 rounded-[14px] bg-[#11804a] py-2.5 pr-2 pl-4 text-white"
                      >
                        <span className="min-w-0">
                          <b className="text-2xl font-extrabold">{seatName(seat)}</b>{" "}
                          <span className="text-sm">{seatPlace(seat)}</span>
                          <br />
                          <b className="text-[15px]">
                            {formatVnd(classes.get(seat.ticketClassId)?.price_vnd ?? 0)}
                          </b>
                        </span>
                        <button
                          type="button"
                          aria-label={`Bỏ ghế ${seatName(seat)}`}
                          onClick={() => press(seat.key)}
                          className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-white/15 outline-none hover:bg-white/25 focus-visible:ring-4 focus-visible:ring-white"
                        >
                          <X aria-hidden="true" className="size-5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 flex items-baseline justify-between">
                  <span>Tạm tính</span>
                  <b
                    className="text-3xl font-extrabold tracking-[-0.03em]"
                    data-testid="seat-total"
                  >
                    {formatVnd(total)}
                  </b>
                </div>
              </div>
            </section>
            <Button type="button" size="lg" disabled className="h-16 text-[19px]">
              Tiếp tục thanh toán
            </Button>
            <p className="m-0 text-sm text-[#a1a1aa]">
              Giữ ghế và thanh toán sắp có. Ghế bạn chọn lúc này chưa được giữ cho bạn.
            </p>
            {message ? (
              <p role="status" className="m-0 bg-[#a7e8c5] px-5 py-4 font-bold text-[#1c1c20]">
                {message}
              </p>
            ) : (
              <p role="status" className="sr-only" />
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function zoneClassName(
  layout: SeatMapLayout,
  zone: number,
  classes: ReadonlyMap<string, { name: string }>,
): string {
  const ids = new Set(
    layout.zones[zone]?.blocks.flatMap((block) => block.rows.map((row) => row.ticket_class_id)),
  );
  return [...ids].map((id) => classes.get(id)?.name ?? "").join(", ");
}

/** Bộ chọn ghế bằng bàn phím/trình đọc màn hình, thay cho thao tác trên canvas. */
function KeyboardPicker({
  geometry,
  layout,
  onAdd,
  disabled,
}: {
  geometry: SeatMapGeometry;
  layout: SeatMapLayout;
  onAdd: (key: string) => void;
  disabled: boolean;
}) {
  const ids = { block: useId(), row: useId(), seat: useId() };
  const [blockIndex, setBlockIndex] = useState(0);
  const [row, setRow] = useState(0);
  const [seatNo, setSeatNo] = useState(1);
  const block = geometry.blocks[blockIndex];
  const rows = block ? (layout.zones[block.zone]?.blocks[block.block]?.rows ?? []) : [];
  const seatCount = rows[row]?.seats ?? 0;
  const select =
    "h-11 min-w-0 cursor-pointer rounded-[12px] border-0 border-b-4 border-[#f4f4f5] bg-[#27272a] px-3 text-base text-[#f4f4f5] outline-none focus-visible:border-[#2dc275]";
  return (
    <form
      aria-label="Chọn ghế bằng bàn phím"
      className="flex flex-wrap items-end gap-3 rounded-[18px] bg-[#27272a] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (block) onAdd(`${block.zone}:${block.block}:${row}:${seatNo}`);
      }}
    >
      <label htmlFor={ids.block} className="flex flex-col gap-1.5 text-sm font-semibold">
        Block · khu
        <select
          id={ids.block}
          className={select}
          value={blockIndex}
          onChange={(e) => {
            setBlockIndex(Number(e.target.value));
            setRow(0);
            setSeatNo(1);
          }}
        >
          {geometry.blocks.map((b, i) => (
            <option key={`${b.zone}:${b.block}`} value={i}>
              {layout.zones[b.zone]?.name} · Khu {b.name}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={ids.row} className="flex flex-col gap-1.5 text-sm font-semibold">
        Hàng
        <select
          id={ids.row}
          className={select}
          value={row}
          onChange={(e) => {
            setRow(Number(e.target.value));
            setSeatNo(1);
          }}
        >
          {rows.map((r, i) => (
            <option key={r.label} value={i}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={ids.seat} className="flex flex-col gap-1.5 text-sm font-semibold">
        Ghế số
        <select
          id={ids.seat}
          className={select}
          value={seatNo}
          onChange={(e) => setSeatNo(Number(e.target.value))}
        >
          {Array.from({ length: seatCount }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {i + 1}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" disabled={disabled}>
        Chọn ghế này
      </Button>
    </form>
  );
}

function MapButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full bg-[#f4f4f5] text-[#1c1c20] outline-none focus-visible:ring-4 focus-visible:ring-[#2dc275]"
    >
      {children}
    </button>
  );
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" className="size-4 rounded-full" style={{ background: color }} />;
}

function Notice({
  title,
  emphasis = "sơ đồ ghế",
  message,
  back,
  onRetry,
}: {
  title: string;
  emphasis?: string;
  message: string;
  back: { to: string; label: string };
  onRetry?: () => void;
}) {
  return (
    <section className="mx-auto flex max-w-[1312px] flex-col items-start gap-5 px-4 py-16 md:px-8 md:py-24 xl:px-16">
      <h1 className="m-0 text-5xl leading-[0.9] font-extrabold tracking-[-0.04em] md:text-7xl">
        {title}
        <br />
        <span className="font-serif font-medium text-emphasis italic">{emphasis}</span>
      </h1>
      <p role="alert" className="m-0 max-w-[50ch] text-lg font-bold">
        {message}
      </p>
      <div className="flex flex-wrap gap-3">
        {onRetry ? (
          <Button type="button" onClick={onRetry}>
            Thử lại
          </Button>
        ) : null}
        <Button asChild variant="secondary">
          <Link to={back.to}>{back.label}</Link>
        </Button>
      </div>
    </section>
  );
}
