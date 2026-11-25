import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/catalog/format";
import { useSalePhaseMutations, type SalePhase } from "@/lib/organizer/api";
import { isVersionConflict, organizerErrorMessage } from "@/lib/organizer/errors";
import {
  fieldErrors,
  salePhaseSchema,
  utcToVnLocal,
  vnLocalToUtc,
  type SalePhaseForm,
} from "@/lib/organizer/forms";
import { CheckField, FormAlert, StepHeading, TextField } from "./form-parts";
import type { StepProps } from "./wizard-page";

// Đợt mở bán: giờ mở/đóng (giờ Việt Nam), giới hạn vé mỗi người, hàng chờ (admit_rate = số người
// được cho vào mỗi giây, kiến trúc mục 3), yêu cầu KYC.

const EMPTY: SalePhaseForm = {
  starts_local: "",
  ends_local: "",
  per_user_limit: "4",
  queue_enabled: false,
  admit_rate: "200",
  require_kyc: false,
};

function toForm(p: SalePhase): SalePhaseForm {
  return {
    starts_local: utcToVnLocal(p.starts_at),
    ends_local: utcToVnLocal(p.ends_at),
    per_user_limit: String(p.per_user_limit),
    queue_enabled: p.queue_enabled,
    admit_rate: String(p.admit_rate),
    require_kyc: p.require_kyc,
  };
}

export function PhasesStep({
  organizerId,
  bundle,
  readOnly,
  onNext,
  onBack,
  onConflict,
}: StepProps) {
  const phases = bundle.salePhases;
  const [adding, setAdding] = useState(phases.length === 0);
  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Đợt mở bán">
        Sự kiện bắt đầu lúc {formatDateTime(bundle.event.start_at)}. Đợt bán phải kết thúc trước giờ
        diễn. Bật hàng chờ cho đợt bán đông người.
      </StepHeading>
      <ul aria-label="Các đợt mở bán" className="m-0 flex list-none flex-col gap-3 p-0">
        {phases.map((p, i) => (
          <li key={`${p.id}:${p.version}`}>
            <PhaseRow
              organizerId={organizerId}
              eventId={bundle.event.id}
              eventStart={bundle.event.start_at}
              current={p}
              title={`Đợt ${i + 1}`}
              readOnly={readOnly}
              onConflict={onConflict}
            />
          </li>
        ))}
        {adding && !readOnly ? (
          <li>
            <PhaseRow
              organizerId={organizerId}
              eventId={bundle.event.id}
              eventStart={bundle.event.start_at}
              current={null}
              title="Đợt mới"
              readOnly={false}
              onConflict={onConflict}
              onDone={() => setAdding(false)}
            />
          </li>
        ) : null}
      </ul>
      {!adding && !readOnly ? (
        <div>
          <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
            + Thêm đợt mở bán
          </Button>
        </div>
      ) : null}
      <div className="flex justify-between gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          ← Lùi
        </Button>
        <Button type="button" size="lg" disabled={phases.length === 0} onClick={onNext}>
          Tiếp: Banner →
        </Button>
      </div>
    </div>
  );
}

function PhaseRow({
  organizerId,
  eventId,
  eventStart,
  current,
  title,
  readOnly,
  onConflict,
  onDone,
}: {
  organizerId: string;
  eventId: string;
  eventStart: string;
  current: SalePhase | null;
  title: string;
  readOnly: boolean;
  onConflict: (message: string) => void;
  onDone?: () => void;
}) {
  const { create, update, remove } = useSalePhaseMutations(organizerId, eventId);
  const [form, setForm] = useState<SalePhaseForm>(current ? toForm(current) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending || remove.isPending;
  const dirty = !current || JSON.stringify(form) !== JSON.stringify(toForm(current));

  const onError = (error: unknown) => {
    if (isVersionConflict(error)) onConflict(organizerErrorMessage(error));
    else setApiError(organizerErrorMessage(error));
  };

  const save = () => {
    const parsed = salePhaseSchema(eventStart).safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setApiError(null);
    const v = parsed.data;
    const body = {
      starts_at: vnLocalToUtc(v.starts_local) ?? "",
      ends_at: vnLocalToUtc(v.ends_local) ?? "",
      per_user_limit: v.per_user_limit,
      queue_enabled: v.queue_enabled,
      admit_rate: v.admit_rate,
      require_kyc: v.require_kyc,
    };
    if (current) {
      update.mutate({ id: current.id, body: { ...body, version: current.version } }, { onError });
    } else {
      create.mutate(body, { onSuccess: () => onDone?.(), onError });
    }
  };

  return (
    <div
      role="group"
      aria-label={title}
      className={current ? "bg-card" : "border-[3px] border-dashed border-foreground"}
    >
      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-4 md:p-5">
        <b aria-hidden="true" className="text-lg">
          {title}
        </b>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <TextField
            label="Mở bán"
            type="datetime-local"
            value={form.starts_local}
            onChange={(e) => setForm({ ...form, starts_local: e.target.value })}
            error={errors.starts_local}
          />
          <TextField
            label="Đóng bán"
            type="datetime-local"
            value={form.ends_local}
            onChange={(e) => setForm({ ...form, ends_local: e.target.value })}
            error={errors.ends_local}
          />
          <TextField
            label="Số vé tối đa mỗi người"
            inputMode="numeric"
            value={form.per_user_limit}
            onChange={(e) => setForm({ ...form, per_user_limit: e.target.value })}
            error={errors.per_user_limit}
          />
          <TextField
            label="Số người cho vào mỗi giây"
            inputMode="numeric"
            value={form.admit_rate}
            onChange={(e) => setForm({ ...form, admit_rate: e.target.value })}
            error={errors.admit_rate}
            hint="Chỉ dùng khi bật hàng chờ."
          />
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
          <CheckField
            label="Bật hàng chờ"
            hint="Người mua vào phòng chờ, được cho vào dần."
            checked={form.queue_enabled}
            onChange={(e) => setForm({ ...form, queue_enabled: e.target.checked })}
          />
          <CheckField
            label="Yêu cầu xác minh danh tính"
            hint="Chỉ tài khoản đã KYC mới mua được."
            checked={form.require_kyc}
            onChange={(e) => setForm({ ...form, require_kyc: e.target.checked })}
          />
        </div>
      </fieldset>
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3 px-4 pb-4 md:px-5">
          {dirty ? (
            <Button type="button" size="sm" onClick={save} disabled={busy}>
              {busy ? "Đang lưu…" : `Lưu ${title.toLowerCase()}`}
            </Button>
          ) : null}
          {current ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setApiError(null);
                remove.mutate({ id: current.id, version: current.version }, { onError });
              }}
            >
              Xóa {title.toLowerCase()}
            </Button>
          ) : onDone ? (
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              Hủy
            </Button>
          ) : null}
        </div>
      )}
      {apiError ? (
        <div className="px-4 pb-4 md:px-5">
          <FormAlert message={apiError} />
        </div>
      ) : null}
    </div>
  );
}
