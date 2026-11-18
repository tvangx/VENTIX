import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Share2 } from "lucide-react";
import { StageBeams } from "@/components/brand/stage-beams";
import { Button } from "@/components/ui/button";
import { toProblem } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  countdownTo,
  formatDateTime,
  formatShortDateTime,
  formatTime,
  formatVnd,
  vnParts,
  formatDate,
} from "@/lib/catalog/format";
import { useEventDetail, useNow } from "@/lib/catalog/queries";
import {
  bannerSrc,
  primaryAction,
  saleStateOf,
  sortPhases,
  tierTones,
  type CatalogDetail,
  type SaleState,
  type TierTone,
} from "@/lib/catalog/sale";
import { TearLine } from "@/pages/explore/event-card";

const TONE_CLASS: Record<TierTone, string> = {
  1: "bg-tier-1 text-tier-1-foreground",
  2: "bg-tier-2 text-tier-2-foreground",
  3: "bg-tier-3 text-tier-3-foreground",
  4: "bg-tier-4 text-tier-4-foreground",
};
const TILTS = ["-rotate-2", "rotate-[1.5deg]", "rotate-1", "-rotate-[1.5deg]"] as const;
const NUMBER_WORDS = ["Không", "Một", "Hai", "Ba", "Bốn", "Năm", "Sáu", "Bảy", "Tám", "Chín"];

function countWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

/** Trang chi tiết sự kiện (V-105 `Event-D`/`Event-M`), dữ liệu từ GET /v1/events/{id}. */
export function EventDetailPage() {
  const { id = "" } = useParams();
  const detail = useEventDetail(id);

  if (detail.isPending) {
    return (
      <p role="status" className="mx-auto max-w-[1312px] px-4 py-16 text-lg md:px-8 xl:px-16">
        Đang tải sự kiện…
      </p>
    );
  }
  if (detail.isError) {
    const problem = toProblem(detail.error);
    const missing = problem?.status === 404 || problem?.status === 400;
    return (
      <section className="mx-auto flex max-w-[1312px] flex-col items-start gap-5 px-4 py-16 md:px-8 md:py-24 xl:px-16">
        <h1 className="m-0 text-5xl leading-[0.9] font-extrabold tracking-[-0.04em] md:text-7xl">
          {missing ? "Không tìm thấy" : "Lỗi tải"}
          <br />
          <span className="font-serif font-medium text-emphasis italic">sự kiện này</span>
        </h1>
        <p role="alert" className="m-0 max-w-[50ch] text-lg font-bold">
          {missing
            ? "Lỗi: sự kiện không tồn tại hoặc chưa được công khai."
            : "Lỗi: chưa tải được thông tin sự kiện. Thử lại sau ít phút."}
        </p>
        <div className="flex flex-wrap gap-3">
          {missing ? null : (
            <Button type="button" onClick={() => void detail.refetch()}>
              Thử lại
            </Button>
          )}
          <Button asChild variant="secondary">
            <Link to="/explore">Xem sự kiện khác</Link>
          </Button>
        </div>
      </section>
    );
  }
  return <EventDetailView event={detail.data} />;
}

function EventDetailView({ event }: { event: CatalogDetail }) {
  const now = useNow(1000);
  const sale = saleStateOf(event.sale_phases, now);
  const action = primaryAction(event, sale, now);
  const prices = event.ticket_classes.map((tc) => tc.price_vnd);
  const minPrice = prices.length ? Math.min(...prices) : null;

  return (
    <article className="pb-6">
      <section className="relative overflow-hidden bg-stage text-stage-foreground">
        <StageBeams />
        <div className="relative mx-auto grid max-w-[1312px] gap-8 px-4 pt-5 pb-14 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-12 md:px-8 md:pt-8 md:pb-20 xl:px-16">
          <div className="flex items-center justify-between md:col-span-2">
            <Link
              to="/explore"
              className="inline-flex h-11 items-center gap-2 rounded-full border-2 border-stage-foreground px-4 font-bold no-underline outline-none focus-visible:ring-4 focus-visible:ring-stage-emphasis/70"
            >
              <ArrowLeft aria-hidden="true" className="size-5" />
              Khám phá
            </Link>
            <ShareButton title={event.title} />
          </div>

          <div className="flex flex-col gap-6 md:order-2">
            <h1 className="m-0 text-[52px] leading-[0.88] font-extrabold tracking-[-0.055em] break-words md:text-[88px]">
              {event.title}
            </h1>
            <dl className="m-0 grid grid-cols-2 gap-4">
              <div>
                <dt className="text-[13px] font-semibold">Khi nào</dt>
                <dd className="m-0 mt-0.5 text-lg font-extrabold md:text-xl">
                  {vnParts(event.start_at).weekday} {formatDate(event.start_at)}
                  <br />
                  <span className="font-serif font-medium italic">
                    {formatTime(event.start_at)} – {formatTime(event.end_at)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-semibold">Ở đâu</dt>
                <dd className="m-0 mt-0.5 text-lg font-extrabold md:text-xl">
                  {event.venue.name}
                  <br />
                  <span className="font-serif font-medium italic">{event.venue.address}</span>
                </dd>
              </div>
            </dl>
            <SaleCountdown sale={sale} now={now} />
          </div>

          <CoverTicket event={event} sale={sale} />
        </div>
      </section>

      <TicketClassesSection event={event} />
      <SalePhasesSection event={event} sale={sale} now={now} />

      <section className="mx-auto grid max-w-[1312px] gap-8 px-4 py-14 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:px-8 md:py-20 xl:px-16">
        <div className="flex flex-col gap-4">
          <h2 className="m-0 text-[44px] leading-[0.9] font-extrabold tracking-[-0.05em] md:text-6xl">
            Về <span className="font-serif font-medium text-emphasis italic">đêm diễn</span>
          </h2>
          <p className="m-0 max-w-[65ch] text-[17px] leading-relaxed whitespace-pre-line">
            {event.description}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 self-start bg-card p-5 text-card-foreground md:rotate-[1.2deg]">
          <b className="text-xl">{event.venue.name}</b>
          <span className="text-[15px]">{event.venue.address}</span>
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              `${event.venue.name}, ${event.venue.address}`,
            )}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex h-11 items-center rounded-full bg-secondary px-5 font-bold text-secondary-foreground no-underline outline-none focus-visible:ring-4 focus-visible:ring-ring"
          >
            Chỉ đường
          </a>
        </div>
      </section>

      <div className="sticky bottom-4 z-30 mx-3 flex max-w-[720px] md:mx-auto items-center gap-3 rounded-full bg-secondary py-2 pr-2 pl-6 text-secondary-foreground shadow-lg">
        <span className="flex-1 text-[13px] leading-tight">
          {minPrice === null ? (
            "Chưa có giá vé"
          ) : (
            <>
              Từ <b className="text-[17px]">{formatVnd(minPrice)}</b>
            </>
          )}
          <br />
          {event.title}
        </span>
        {action.enabled ? (
          <Button asChild size="lg">
            <Link to={`/events/${event.id}/buy`}>{action.label}</Link>
          </Button>
        ) : (
          <Button type="button" size="lg" disabled>
            {action.label}
          </Button>
        )}
      </div>
    </article>
  );
}

function CoverTicket({ event, sale }: { event: CatalogDetail; sale: SaleState }) {
  const src = bannerSrc(event.banner_key);
  const limit = sale.phase?.per_user_limit;
  return (
    <div className="relative md:order-1">
      <div className="mx-auto w-full max-w-[520px] -rotate-3 bg-card text-card-foreground">
        {src ? (
          <img src={src} alt="" className="block aspect-[16/10] w-full object-cover" />
        ) : (
          <div
            aria-hidden="true"
            className="relative aspect-[16/10] overflow-hidden bg-tier-2 text-tier-2-foreground"
          >
            <span className="absolute -top-10 -right-10 size-48 rounded-full bg-current opacity-20" />
            <span className="absolute bottom-2 left-5 text-[120px] leading-[0.8] font-extrabold tracking-[-0.06em]">
              {String(vnParts(event.start_at).day).padStart(2, "0")}
            </span>
          </div>
        )}
        <TearLine />
        <div className="px-5 pt-4 pb-5 text-sm font-semibold">
          {formatDateTime(event.start_at)} · {event.venue.name}
        </div>
      </div>
      {limit ? (
        <div
          aria-hidden="true"
          className="absolute -top-5 -right-1 size-[96px] rotate-12 md:top-auto md:right-4 md:-bottom-6 md:size-[130px]"
        >
          <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
            <polygon
              className="fill-tier-1"
              points="50,0 59,21 80,8 75,32 99,33 81,49 99,66 75,67 80,92 59,79 50,100 41,79 20,92 25,67 1,66 19,49 1,33 25,32 20,8 41,21"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-center text-sm leading-[1.05] font-extrabold text-tier-1-foreground">
            Tối đa
            <br />
            {limit} vé
          </span>
        </div>
      ) : null}
    </div>
  );
}

function SaleCountdown({ sale, now }: { sale: SaleState; now: number }) {
  if (!sale.phase || sale.status === "CLOSED") return null;
  const target = sale.status === "UPCOMING" ? sale.phase.starts_at : sale.phase.ends_at;
  const left = countdownTo(target, now);
  if (!left) return null;
  const caption = sale.status === "UPCOMING" ? "Mở bán sau" : "Đợt bán đóng sau";
  const parts = [
    { value: left.days, unit: "ngày" },
    { value: left.hours, unit: "giờ" },
    { value: left.minutes, unit: "phút" },
    { value: left.seconds, unit: "giây" },
  ];
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[15px] font-semibold">{caption}</span>
      {/* Nhãn đọc theo phút để trình đọc màn hình không đọc lại mỗi giây. */}
      <div
        role="timer"
        aria-label={`${caption} ${left.days} ngày ${left.hours} giờ ${left.minutes} phút`}
        className="flex max-w-[440px] gap-2"
      >
        {parts.map((part, i) => (
          <div
            key={part.unit}
            aria-hidden="true"
            className={cn(
              "flex-1 p-2.5 text-center",
              i === parts.length - 1
                ? "bg-primary text-primary-foreground"
                : "bg-card text-card-foreground",
              TILTS[i],
            )}
          >
            <b className="block text-4xl leading-[0.9] font-extrabold">
              {String(part.value).padStart(2, "0")}
            </b>
            <span className="text-xs font-semibold">{part.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TicketClassesSection({ event }: { event: CatalogDetail }) {
  if (event.ticket_classes.length === 0) return null;
  const tones = tierTones(event.ticket_classes);
  const classes = [...event.ticket_classes].sort(
    (a, b) => b.price_vnd - a.price_vnd || a.id.localeCompare(b.id),
  );
  const seated = classes.some((tc) => tc.kind === "SEATED");
  return (
    <section className="bg-card text-card-foreground">
      <div className="mx-auto flex max-w-[1312px] flex-col gap-8 px-4 py-14 md:px-8 md:py-20 xl:px-16">
        <h2 className="m-0 text-[44px] leading-[0.9] font-extrabold tracking-[-0.05em] md:text-6xl">
          {countWord(classes.length)} hạng vé
          {seated ? (
            <>
              <br />
              <span className="font-serif font-medium text-emphasis italic">một sơ đồ</span>
            </>
          ) : null}
        </h2>
        <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 md:grid-cols-4 md:gap-6">
          {classes.map((tc, i) => (
            <li
              key={tc.id}
              className={cn(
                "p-4 md:p-6",
                TONE_CLASS[tones.get(tc.id) ?? 4],
                TILTS[i % TILTS.length],
              )}
            >
              <b className="block text-[26px] leading-tight font-extrabold md:text-[32px]">
                {tc.name}
              </b>
              <span className="block text-lg font-extrabold">{formatVnd(tc.price_vnd)}</span>
              <span className="font-serif text-sm italic">
                {tc.capacity.toLocaleString("vi-VN")} {tc.kind === "SEATED" ? "ghế" : "vé đứng"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SalePhasesSection({
  event,
  sale,
  now,
}: {
  event: CatalogDetail;
  sale: SaleState;
  now: number;
}) {
  const phases = sortPhases(event.sale_phases);
  if (phases.length === 0) return null;
  return (
    <section className="mx-auto flex max-w-[1312px] flex-col gap-8 px-4 py-14 md:px-8 md:py-20 xl:px-16">
      <h2 className="m-0 text-[44px] leading-[0.9] font-extrabold tracking-[-0.05em] md:text-6xl">
        {countWord(phases.length)} đợt{" "}
        <span className="font-serif font-medium text-emphasis italic">mở bán</span>
      </h2>
      <ol className="m-0 grid list-none gap-5 p-0 md:grid-cols-2">
        {phases.map((phase, i) => {
          const current = sale.phase?.id === phase.id && sale.status === "ON_SALE";
          const ended = Date.parse(phase.ends_at) <= now;
          const rules = [
            phase.queue_enabled ? "Phòng chờ" : "Không cần xếp hàng",
            `tối đa ${phase.per_user_limit} vé`,
            ...(phase.require_kyc ? ["cần xác minh CCCD"] : []),
          ];
          return (
            <li
              key={phase.id}
              className={cn(
                "flex flex-col gap-1.5 p-5",
                current ? "bg-primary text-primary-foreground" : "bg-card text-card-foreground",
                ended && "opacity-70",
                i % 2 === 0 ? "-rotate-1" : "rotate-1",
              )}
            >
              <span className="text-sm font-semibold">
                Đợt {i + 1}
                {current ? " · Đang mở" : ended ? " · Đã kết thúc" : ""}
              </span>
              <b className="text-2xl leading-none font-extrabold md:text-[28px]">
                {formatShortDateTime(phase.starts_at)} → {formatShortDateTime(phase.ends_at)}
              </b>
              <span className="text-[15px]">{rules.join(" · ")}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Người dùng hủy chia sẻ hoặc trình duyệt chặn clipboard: không cần báo lỗi.
    }
  };
  return (
    <button
      type="button"
      onClick={() => void share()}
      className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border-2 border-stage-foreground px-4 font-bold outline-none focus-visible:ring-4 focus-visible:ring-stage-emphasis/70"
    >
      <Share2 aria-hidden="true" className="size-5" />
      <span aria-live="polite">{copied ? "Đã chép link" : "Chia sẻ"}</span>
    </button>
  );
}
