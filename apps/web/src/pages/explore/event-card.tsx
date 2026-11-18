import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formatDayMonth, formatTime, formatVnd, vnParts } from "@/lib/catalog/format";
import { bannerSrc, cardStatusLabel, type CatalogCard } from "@/lib/catalog/sale";

// Thẻ sự kiện dạng tấm vé (V-105 "Thẻ sự kiện"): bìa ảnh hoặc poster chữ, đường xé có hai lỗ
// khuyết, thẻ xoay nhẹ và thẳng lại khi rê chuột/focus.

const TILTS = ["-rotate-1", "rotate-[0.8deg]", "-rotate-[0.6deg]", "rotate-[1.2deg]"] as const;
const COVERS = [
  "bg-tier-2 text-tier-2-foreground",
  "bg-tier-1 text-tier-1-foreground",
  "bg-secondary text-secondary-foreground",
  "bg-tier-3 text-tier-3-foreground",
] as const;

function priceText(card: CatalogCard): string {
  return card.min_ticket_price_vnd === null
    ? "Chưa có giá"
    : `từ ${formatVnd(card.min_ticket_price_vnd)}`;
}

function whenText(card: CatalogCard): string {
  const p = vnParts(card.start_at);
  return `${p.weekday} ${formatDayMonth(card.start_at)} · ${formatTime(card.start_at)}`;
}

export function EventTicketCard({ card, index }: { card: CatalogCard; index: number }) {
  const src = bannerSrc(card.banner_key);
  const cover = COVERS[index % COVERS.length];
  return (
    <Link
      to={`/events/${card.id}`}
      className={cn(
        "group flex flex-col bg-card text-card-foreground no-underline outline-none transition-transform duration-300 hover:-translate-y-1.5 hover:rotate-0 focus-visible:rotate-0 focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
        TILTS[index % TILTS.length],
      )}
    >
      <div className={cn("relative aspect-[16/9] overflow-hidden", !src && cover)}>
        {src ? (
          <img src={src} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div aria-hidden="true" className="relative size-full">
            <span className="absolute -top-8 -right-8 size-32 rounded-full bg-current opacity-20" />
            <span className="absolute bottom-1 left-4 text-[88px] leading-[0.8] font-extrabold tracking-[-0.06em]">
              {String(vnParts(card.start_at).day).padStart(2, "0")}
            </span>
          </div>
        )}
        <span className="absolute top-3 left-3 rounded-full bg-secondary px-3 py-1 text-[13px] font-bold text-secondary-foreground">
          {cardStatusLabel(card)}
        </span>
      </div>
      <TearLine />
      <div className="flex flex-col gap-1 px-4 pt-4 pb-5">
        <span className="text-[13px] font-semibold">{whenText(card)}</span>
        <h3 className="m-0 text-xl leading-[1.1] font-extrabold tracking-[-0.03em]">
          {card.title}
        </h3>
        <span className="text-sm">
          {card.venue_name} · <b>{priceText(card)}</b>
        </span>
      </div>
    </Link>
  );
}

export function EventListRow({ card }: { card: CatalogCard }) {
  const p = vnParts(card.start_at);
  return (
    <Link
      to={`/events/${card.id}`}
      className="grid grid-cols-[76px_minmax(0,1fr)] gap-4 bg-card text-card-foreground no-underline outline-none focus-visible:ring-4 focus-visible:ring-ring md:grid-cols-[96px_minmax(0,1fr)_auto]"
    >
      <span className="flex flex-col items-center justify-center bg-secondary py-3 text-secondary-foreground">
        <b className="text-3xl leading-[0.9] font-extrabold tracking-[-0.05em]">
          {String(p.day).padStart(2, "0")}
        </b>
        <span className="font-serif text-[13px] italic">th {p.month}</span>
      </span>
      <span className="flex min-w-0 flex-col gap-1 py-3 pr-4">
        <b className="text-[17px] leading-[1.15] font-extrabold">{card.title}</b>
        <span className="text-[13px]">
          {p.weekday} · {formatTime(card.start_at)} · {card.venue_name}
        </span>
        <span className="text-[13px]">
          <b>{priceText(card)}</b> · {cardStatusLabel(card)}
        </span>
      </span>
      <span className="hidden items-center pr-5 md:flex">
        <span className="rounded-full border-2 border-current px-4 py-2 text-sm font-bold">
          Xem vé
        </span>
      </span>
    </Link>
  );
}

/** Đường xé răng cưa + hai lỗ khuyết, cùng màu nền trang. */
export function TearLine() {
  return (
    <div aria-hidden="true" className="relative h-0">
      <div className="absolute inset-x-3.5 -top-px border-t-[3px] border-dashed border-background" />
      <div className="absolute -top-[11px] -left-[11px] size-[22px] rounded-full bg-background" />
      <div className="absolute -top-[11px] -right-[11px] size-[22px] rounded-full bg-background" />
    </div>
  );
}
