import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatDate, formatTime, formatVnd } from "@/lib/catalog/format";
import {
  isEditable,
  STATUS_LABEL,
  useEventBundle,
  useVenues,
  type EventBundle,
} from "@/lib/organizer/api";
import { organizerErrorMessage } from "@/lib/organizer/errors";
import { readiness, type Readiness } from "@/lib/organizer/readiness";
import { cn } from "@/lib/utils";
import { useOrganizer } from "../organizer-context";
import { BannerStep } from "./banner-step";
import { ClassesStep } from "./classes-step";
import { InfoStep } from "./info-step";
import { PhasesStep } from "./phases-step";
import { ReviewStep } from "./review-step";
import { NoSeatMapStep, SeatMapStep } from "./seat-map-step";

// Wizard tạo sự kiện (V-203, wireframe V-105 `Wizard-D`/`Wizard-M`). Mỗi bước lưu thẳng lên
// event-service (sự kiện ở DRAFT), nên tải lại trang hay quay lại sau vẫn tiếp tục được.
// Bước hiện tại nằm trên URL (?step=…).

export type StepId = "info" | "classes" | "seatmap" | "phases" | "banner" | "review";

const STEP_LABEL: Record<StepId, string> = {
  info: "Thông tin",
  classes: "Hạng vé",
  seatmap: "Sơ đồ",
  phases: "Đợt mở bán",
  banner: "Banner",
  review: "Gửi duyệt",
};

// Bước Sơ đồ bắt buộc khi có hạng vé: hạng có ghế cần hàng ghế, hạng đứng cần khu đứng (issue #98).
const STEPS: StepId[] = ["info", "classes", "seatmap", "phases", "banner", "review"];

const hasClasses = (bundle: EventBundle | undefined) =>
  bundle ? bundle.ticketClasses.length > 0 : false;

function stepDone(step: StepId, r: Readiness, bundle: EventBundle | undefined): boolean {
  if (step === "review") return bundle ? !isEditable(bundle.event.status) : false;
  return r[step];
}

export interface StepProps {
  organizerId: string;
  bundle: EventBundle;
  readOnly: boolean;
  /** Lưu xong: sang bước sau. */
  onNext: () => void;
  onBack: () => void;
  /**
   * Gặp xung đột version: wizard giữ thông báo (bước có thể bị dựng lại với dữ liệu mới) rồi tải
   * lại sự kiện.
   */
  onConflict: (message: string) => void;
}

export function OrganizerWizardPage() {
  const { organizerId } = useOrganizer();
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const query = useEventBundle(organizerId, id);
  const venues = useVenues(organizerId);
  const bundle = query.data;
  const steps = STEPS;
  const requested = params.get("step") as StepId | null;
  const step: StepId = id && requested && steps.includes(requested) ? requested : "info";
  const r = readiness(bundle);
  const readOnly = bundle ? !isEditable(bundle.event.status) : false;
  // Ảnh banner vừa chọn (object URL) để thẻ xem trước hiện ngay; API chưa có URL công khai.
  const [bannerPreview, setBannerPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (bannerPreview) URL.revokeObjectURL(bannerPreview);
    },
    [bannerPreview],
  );

  const go = (next: StepId) => {
    setNotice(null);
    setParams({ step: next });
  };
  const index = steps.indexOf(step);
  const onNext = () => {
    const next = steps[index + 1];
    if (next) go(next);
  };
  const onBack = () => {
    const prev = steps[index - 1];
    if (prev) go(prev);
  };
  const reload = () => void query.refetch();
  const onConflict = (message: string) => {
    setNotice(message);
    reload();
  };

  if (id && query.isPending) {
    return <p role="status">Đang tải sự kiện…</p>;
  }
  if (id && query.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="m-0 font-bold">{organizerErrorMessage(query.error)}</p>
        <Button variant="outline" onClick={reload}>
          Thử lại
        </Button>
      </div>
    );
  }

  const venueName = venues.data?.find((v) => v.id === bundle?.event.venue_id)?.name ?? null;
  const shared = bundle ? { organizerId, bundle, readOnly, onNext, onBack, onConflict } : null;

  return (
    <div className="flex flex-col gap-8 md:gap-9">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="m-0 text-[40px] leading-[0.9] font-extrabold tracking-[-0.05em] md:text-[60px]">
          Dựng một đêm
          <br />
          <span className="font-serif text-[28px] font-medium tracking-[-0.02em] text-emphasis italic md:text-[60px]">
            {bundle?.event.title ?? "sự kiện mới"}
          </span>
        </h1>
        {bundle ? (
          <span className="rounded-full bg-card px-4 py-2.5 text-[15px] font-semibold">
            {STATUS_LABEL[bundle.event.status]} · lưu lúc {formatTime(bundle.event.updated_at)}
          </span>
        ) : null}
      </div>

      <ol
        aria-label="Các bước"
        className="m-0 flex list-none gap-3 overflow-x-auto p-0 pb-2 xl:grid xl:grid-flow-col xl:auto-cols-fr xl:overflow-visible"
      >
        {steps.map((s, i) => {
          const current = s === step;
          const done = stepDone(s, r, bundle);
          const reachable = s === "info" || bundle !== undefined;
          return (
            <li key={s} className="min-w-0 shrink-0">
              <button
                type="button"
                disabled={!reachable}
                aria-current={current ? "step" : undefined}
                onClick={() => go(s)}
                className={cn(
                  "flex h-full w-full cursor-pointer flex-col items-start gap-0.5 px-4 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                  current
                    ? "bg-[#a7e8c5] text-[#1c1c20] outline-4 -outline-offset-4 outline-[#1c1c20]"
                    : done
                      ? "bg-foreground text-background"
                      : "border-2 border-dashed border-foreground",
                )}
              >
                <b className="whitespace-nowrap text-base xl:text-lg">
                  {i + 1}. {STEP_LABEL[s]}
                </b>
                <span className="whitespace-nowrap font-serif text-sm italic">
                  {current ? "đang thực hiện" : done ? "đã xong ✓" : "chưa thiết lập"}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {readOnly ? (
        <p role="status" className="m-0 bg-accent px-4 py-3 font-semibold text-accent-foreground">
          Sự kiện đang ở trạng thái “{STATUS_LABEL[bundle?.event.status ?? "PENDING"]}” nên chỉ xem
          được, không sửa được.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-10">
        <section
          aria-label={STEP_LABEL[step]}
          className="flex min-w-0 flex-[999_1_520px] flex-col gap-5"
        >
          {notice ? (
            <p role="alert" className="m-0 bg-accent px-4 py-3 font-bold text-accent-foreground">
              {notice}
            </p>
          ) : null}
          {step === "info" || !shared ? (
            <InfoStep
              key={bundle?.event.version ?? "new"}
              organizerId={organizerId}
              bundle={bundle}
              readOnly={readOnly}
              onConflict={onConflict}
              onSaved={(eventId, created) => {
                if (created)
                  navigate(`/organizer/events/${eventId}?step=classes`, { replace: true });
                else go("classes");
              }}
            />
          ) : step === "classes" ? (
            <ClassesStep {...shared} />
          ) : step === "seatmap" ? (
            hasClasses(shared.bundle) ? (
              <SeatMapStep {...shared} />
            ) : (
              <NoSeatMapStep {...shared} goTo={go} />
            )
          ) : step === "phases" ? (
            <PhasesStep {...shared} />
          ) : step === "banner" ? (
            <BannerStep
              {...shared}
              preview={bannerPreview}
              onPreview={(url) => setBannerPreview(url)}
            />
          ) : (
            <ReviewStep {...shared} readiness={r} goTo={go} stepLabel={STEP_LABEL} />
          )}
        </section>
        <PreviewCard bundle={bundle} venueName={venueName} bannerPreview={bannerPreview} />
      </div>

      <p className="m-0">
        <Link
          to="/organizer/events"
          className="font-semibold text-link underline-offset-4 hover:underline"
        >
          ← Về danh sách sự kiện
        </Link>
      </p>
    </div>
  );
}

/** "khán giả sẽ thấy…": thẻ sự kiện như trên trang khám phá. */
function PreviewCard({
  bundle,
  venueName,
  bannerPreview,
}: {
  bundle: EventBundle | undefined;
  venueName: string | null;
  bannerPreview: string | null;
}) {
  const event = bundle?.event;
  const classes = [...(bundle?.ticketClasses ?? [])].sort((a, b) => b.price_vnd - a.price_vnd);
  return (
    <aside aria-label="Xem trước" className="flex flex-[1_1_300px] flex-col gap-3.5">
      <h2 className="m-0 font-serif text-[22px] font-medium italic">khán giả sẽ thấy…</h2>
      <div className="bg-[#1c1c20] text-[#f4f4f5] ring-[#3f3f46] md:rotate-[1.5deg] dark:ring-2">
        {bannerPreview ? (
          <img
            src={bannerPreview}
            alt="Ảnh banner đã chọn"
            className="block h-[170px] w-full object-cover"
          />
        ) : (
          <div className="flex h-[170px] items-end bg-[#27272a] p-4 font-serif text-2xl italic text-[#a7e8c5]">
            {event?.banner_key ? "Đã có banner" : "Chưa có banner"}
          </div>
        )}
        <div className="flex flex-col gap-2 p-[18px]">
          <span className="text-sm font-semibold">
            {event
              ? `${formatDate(event.start_at)} · ${formatTime(event.start_at)}${venueName ? ` · ${venueName}` : ""}`
              : "Ngày giờ · địa điểm"}
          </span>
          <b className="text-[28px] leading-none font-extrabold tracking-[-0.03em] break-words">
            {event?.title ?? "Tên sự kiện"}
          </b>
          {classes.length > 0 ? (
            <ul aria-label="Hạng vé" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
              {classes.map((c) => (
                <li
                  key={c.id}
                  className="rounded-full bg-[#2dc275] px-2.5 py-1 text-[13px] font-bold text-[#1c1c20]"
                >
                  {c.name} {formatVnd(c.price_vnd)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <p className="m-0 text-sm leading-normal">
        Sau khi gửi, sự kiện ở trạng thái Chờ duyệt cho đến khi Admin duyệt.
      </p>
    </aside>
  );
}
