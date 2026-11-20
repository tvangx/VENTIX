import { useId, useState, type ReactNode } from "react";
import { RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DATE_LABELS,
  DATE_PRESETS,
  PRICE_BANDS,
  SALE_STATUS_OPTIONS,
  type DatePreset,
  type ExploreFilters,
  type PriceBand,
  type SaleStatus,
} from "@/lib/catalog/filters";

// Cuống lọc dạng cuống vé (V-105 "Khám phá"): bấm cuống mở bảng chọn ngay bên dưới.
// Chỉ có các bộ lọc event-service hỗ trợ (S-204): ngày, giá vé, tình trạng bán.

type Panel = "date" | "price" | "status";

const STUBS: { key: Panel; name: string; tone: string; tilt: string }[] = [
  { key: "date", name: "Ngày", tone: "bg-tier-3 text-tier-3-foreground", tilt: "-rotate-1" },
  { key: "price", name: "Giá vé", tone: "bg-card text-card-foreground", tilt: "rotate-[1.5deg]" },
  {
    key: "status",
    name: "Tình trạng",
    tone: "bg-tier-1 text-tier-1-foreground",
    tilt: "-rotate-[1.5deg]",
  },
];

const PANEL_TITLES: Record<Panel, string> = {
  date: "Đi vào ngày nào?",
  price: "Mỗi vé khoảng bao nhiêu?",
  status: "Tình trạng vé",
};

interface FilterBarProps {
  filters: ExploreFilters;
  onChange: (next: Partial<ExploreFilters>) => void;
  onReset: () => void;
}

function dateValue(filters: ExploreFilters): string {
  if (!filters.date) return "Mọi ngày";
  if (filters.date !== "range") return DATE_LABELS[filters.date];
  const show = (day: string) => day.split("-").reverse().slice(0, 2).join(".");
  if (filters.from && filters.to) return `${show(filters.from)} – ${show(filters.to)}`;
  return filters.from ? `Từ ${show(filters.from)}` : `Đến ${show(filters.to ?? "")}`;
}

export function FilterBar({ filters, onChange, onReset }: FilterBarProps) {
  const [open, setOpen] = useState<Panel | null>(null);
  const panelId = useId();
  const values: Record<Panel, string> = {
    date: dateValue(filters),
    price: filters.price ? PRICE_BANDS[filters.price].label : "Mọi mức",
    status: filters.status ? SALE_STATUS_OPTIONS[filters.status] : "Tất cả",
  };

  return (
    <div className="relative">
      <div
        role="toolbar"
        aria-label="Bộ lọc"
        className="flex flex-wrap items-center gap-3 md:gap-5"
      >
        {STUBS.map((stub) => (
          <button
            key={stub.key}
            type="button"
            aria-expanded={open === stub.key}
            aria-controls={open === stub.key ? panelId : undefined}
            onClick={() => setOpen(open === stub.key ? null : stub.key)}
            className={cn(
              "relative flex min-w-[132px] cursor-pointer flex-col gap-1 px-[18px] pt-3.5 pb-4 text-left outline-none transition-transform duration-200 hover:-translate-y-1 hover:rotate-0 focus-visible:ring-4 focus-visible:ring-ring motion-reduce:transition-none md:min-w-[180px]",
              stub.tone,
              stub.tilt,
              open === stub.key && "rotate-0 ring-2 ring-foreground",
            )}
          >
            <span className="text-[13px] font-semibold">{stub.name}</span>
            <span className="text-xl leading-none font-extrabold tracking-[-0.03em] whitespace-nowrap">
              {values[stub.key]}
            </span>
            <span
              aria-hidden="true"
              className="absolute top-1/2 -left-2 -mt-2 size-4 rounded-full bg-background"
            />
            <span
              aria-hidden="true"
              className="absolute top-1/2 -right-2 -mt-2 size-4 rounded-full bg-background"
            />
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setOpen(null);
            onReset();
          }}
          className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border-[3px] border-primary px-4 text-sm font-extrabold outline-none focus-visible:ring-4 focus-visible:ring-ring"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Đặt lại
        </button>
      </div>

      {open ? (
        <section
          id={panelId}
          aria-label={PANEL_TITLES[open]}
          className="mt-5 flex flex-col gap-5 bg-card p-5 text-card-foreground md:p-7"
        >
          <div className="flex items-center justify-between gap-4 border-b-[3px] border-dashed border-foreground pb-4">
            <h2 className="m-0 text-2xl font-extrabold tracking-[-0.03em] md:text-[28px]">
              {PANEL_TITLES[open]}
            </h2>
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label="Đóng bảng lọc"
              className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-secondary text-secondary-foreground outline-none focus-visible:ring-4 focus-visible:ring-ring"
            >
              <X aria-hidden="true" className="size-5" />
            </button>
          </div>
          {open === "date" ? <DatePanel filters={filters} onChange={onChange} /> : null}
          {open === "price" ? (
            <ChipGroup label="Giá vé">
              {(Object.keys(PRICE_BANDS) as PriceBand[]).map((band) => (
                <Chip
                  key={band}
                  on={filters.price === band}
                  onClick={() => onChange({ price: filters.price === band ? null : band })}
                >
                  {PRICE_BANDS[band].label}
                </Chip>
              ))}
            </ChipGroup>
          ) : null}
          {open === "status" ? (
            <ChipGroup label="Tình trạng">
              {(Object.keys(SALE_STATUS_OPTIONS) as SaleStatus[]).map((status) => (
                <Chip
                  key={status}
                  on={filters.status === status}
                  onClick={() => onChange({ status: filters.status === status ? null : status })}
                >
                  {SALE_STATUS_OPTIONS[status]}
                </Chip>
              ))}
            </ChipGroup>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function DatePanel({ filters, onChange }: Pick<FilterBarProps, "filters" | "onChange">) {
  const fromId = useId();
  const toId = useId();
  const pickPreset = (preset: DatePreset) => {
    if (filters.date === preset) {
      onChange({ date: null, from: null, to: null });
    } else {
      onChange({ date: preset, from: null, to: null });
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <ChipGroup label="Ngày">
        {DATE_PRESETS.map((preset) => (
          <Chip key={preset} on={filters.date === preset} onClick={() => pickPreset(preset)}>
            {DATE_LABELS[preset]}
          </Chip>
        ))}
      </ChipGroup>
      {filters.date === "range" ? (
        <div className="flex flex-wrap gap-4">
          <label htmlFor={fromId} className="flex flex-col gap-2 text-[15px] font-semibold">
            Từ ngày
            <input
              id={fromId}
              type="date"
              value={filters.from ?? ""}
              max={filters.to ?? undefined}
              onChange={(e) => onChange({ from: e.target.value || null })}
              className="h-12 rounded-[14px] border-0 border-b-4 border-input bg-field px-4 text-base text-foreground outline-none focus-visible:border-link"
            />
          </label>
          <label htmlFor={toId} className="flex flex-col gap-2 text-[15px] font-semibold">
            Đến ngày
            <input
              id={toId}
              type="date"
              value={filters.to ?? ""}
              min={filters.from ?? undefined}
              onChange={(e) => onChange({ to: e.target.value || null })}
              className="h-12 rounded-[14px] border-0 border-b-4 border-input bg-field px-4 text-base text-foreground outline-none focus-visible:border-link"
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2.5">
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "min-h-11 cursor-pointer rounded-[14px] px-4 py-2 text-left text-lg font-extrabold outline-none transition-transform hover:scale-105 focus-visible:ring-4 focus-visible:ring-ring motion-reduce:transition-none",
        on ? "bg-primary text-primary-foreground" : "border-2 border-foreground bg-transparent",
      )}
    >
      {children}
    </button>
  );
}
