import { useState } from "react";
import { Check, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatVnd } from "@/lib/catalog/format";
import { STATUS_LABEL, useSubmitEvent } from "@/lib/organizer/api";
import { isVersionConflict, organizerErrorMessage } from "@/lib/organizer/errors";
import { canSubmit, gaClasses, seatedClasses, type Readiness } from "@/lib/organizer/readiness";
import { FormAlert, StepHeading } from "./form-parts";
import type { StepId, StepProps } from "./wizard-page";

interface Props extends StepProps {
  readiness: Readiness;
  goTo: (step: StepId) => void;
  stepLabel: Record<StepId, string>;
}

/** Xem lại và gửi duyệt (DRAFT/REJECTED → PENDING). */
export function ReviewStep({
  organizerId,
  bundle,
  readOnly,
  onBack,
  onConflict,
  readiness: r,
  goTo,
  stepLabel,
}: Props) {
  const submit = useSubmitEvent(organizerId, bundle.event.id);
  const [apiError, setApiError] = useState<string | null>(null);
  const seatedCount = seatedClasses(bundle).length;
  const standingCount = gaClasses(bundle).length;
  const mapParts = [
    seatedCount > 0 ? "ghế khớp hạng vé" : null,
    standingCount > 0 ? `${standingCount} khu đứng` : null,
  ].filter((x): x is string => x !== null);
  const checks: { step: StepId; ok: boolean; text: string; optional?: boolean }[] = [
    {
      step: "info",
      ok: r.info,
      text: `${bundle.event.title} · ${formatDateTime(bundle.event.start_at)}`,
    },
    {
      step: "classes",
      ok: r.classes,
      text: r.classes
        ? bundle.ticketClasses.map((c) => `${c.name} ${formatVnd(c.price_vnd)}`).join(" · ")
        : "Chưa có hạng vé",
    },
    ...(seatedCount + standingCount > 0
      ? [
          {
            step: "seatmap" as const,
            ok: r.seatmap,
            text: r.seatmap
              ? `Phiên bản ${bundle.seatMap?.version ?? 0} · ${mapParts.join(" · ")}`
              : `Chưa có sơ đồ đủ ${mapParts.join(" và ")}`,
          },
        ]
      : []),
    {
      step: "phases",
      ok: r.phases,
      text: r.phases ? `${bundle.salePhases.length} đợt` : "Chưa có đợt mở bán",
    },
    {
      step: "banner",
      ok: r.banner,
      text: r.banner ? "Đã có banner" : "Chưa có banner (không bắt buộc)",
      optional: true,
    },
  ];
  const ready = canSubmit(r);

  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Gửi duyệt">
        Admin xem lại thông tin trước khi sự kiện được công khai. Sau khi gửi, sự kiện không sửa
        được cho tới khi Admin duyệt hoặc từ chối.
      </StepHeading>
      <ul aria-label="Kiểm tra trước khi gửi" className="m-0 flex list-none flex-col gap-2 p-0">
        {checks.map((c) => (
          <li
            key={c.step}
            className="flex flex-wrap items-center justify-between gap-3 bg-card px-4 py-3"
          >
            <span className="min-w-0">
              <b className="flex items-center gap-1.5">
                {c.ok ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : c.optional ? (
                  <Minus aria-hidden="true" className="size-4" />
                ) : (
                  <X aria-hidden="true" className="size-4" />
                )}
                <span className="sr-only">
                  {c.ok ? "Xong:" : c.optional ? "Không bắt buộc:" : "Còn thiếu:"}
                </span>
                {stepLabel[c.step]}
              </b>
              <span className="block text-[15px] break-words">{c.text}</span>
            </span>
            {!readOnly && !c.ok ? (
              <Button type="button" size="sm" variant="outline" onClick={() => goTo(c.step)}>
                Sửa {stepLabel[c.step].toLowerCase()}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {readOnly ? (
        <p role="status" className="m-0 text-lg font-bold">
          Đã gửi. Trạng thái: {STATUS_LABEL[bundle.event.status]}.
        </p>
      ) : null}
      <FormAlert message={apiError} />
      <div className="flex justify-between gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          ← Banner
        </Button>
        {readOnly ? null : (
          <Button
            type="button"
            size="lg"
            disabled={!ready || submit.isPending}
            onClick={() => {
              setApiError(null);
              submit.mutate(bundle.event.version, {
                onError: (error) => {
                  if (isVersionConflict(error)) onConflict(organizerErrorMessage(error));
                  else setApiError(organizerErrorMessage(error));
                },
              });
            }}
          >
            {submit.isPending ? "Đang gửi…" : "Gửi duyệt"}
          </Button>
        )}
      </div>
    </div>
  );
}
