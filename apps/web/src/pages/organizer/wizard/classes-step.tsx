import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCompactVnd } from "@/lib/catalog/format";
import { useTicketClassMutations, useVenues, type TicketClass } from "@/lib/organizer/api";
import { isVersionConflict, organizerErrorMessage } from "@/lib/organizer/errors";
import { fieldErrors, TicketClassSchema, type TicketClassForm } from "@/lib/organizer/forms";
import { cn } from "@/lib/utils";
import { FormAlert, SelectField, StepHeading, TextField } from "./form-parts";
import type { StepProps } from "./wizard-page";

const EMPTY: TicketClassForm = { name: "", kind: "GA", price_vnd: "", capacity: "" };
const KIND_LABEL = { GA: "Vé đứng (GA)", SEATED: "Có chỗ ngồi" } as const;

function toForm(c: TicketClass): TicketClassForm {
  return {
    name: c.name,
    kind: c.kind,
    price_vnd: c.price_vnd.toLocaleString("vi-VN"),
    capacity: c.capacity.toLocaleString("vi-VN"),
  };
}

export function ClassesStep({
  organizerId,
  bundle,
  readOnly,
  onNext,
  onBack,
  onConflict,
}: StepProps) {
  const venues = useVenues(organizerId);
  const capacity = venues.data?.find((v) => v.id === bundle.event.venue_id)?.capacity ?? null;
  const classes = bundle.ticketClasses;
  const total = classes.reduce((sum, c) => sum + c.capacity, 0);
  const [adding, setAdding] = useState(classes.length === 0);

  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Hạng vé">
        {capacity !== null ? `Sức chứa địa điểm: ${capacity.toLocaleString("vi-VN")}. ` : ""}
        Hạng có chỗ ngồi sẽ được xếp vào sơ đồ ghế ở bước sau. Giá là số nguyên VND, 0 là vé miễn
        phí.
      </StepHeading>

      <ul aria-label="Các hạng vé" className="m-0 flex list-none flex-col gap-3 p-0">
        {classes.map((c, i) => (
          <li key={`${c.id}:${c.version}`}>
            <ClassRow
              organizerId={organizerId}
              eventId={bundle.event.id}
              current={c}
              tone={i % 2 === 0 ? "bg-[#2dc275]" : "bg-[#a7e8c5]"}
              readOnly={readOnly}
              onConflict={onConflict}
            />
          </li>
        ))}
        {adding && !readOnly ? (
          <li>
            <ClassRow
              organizerId={organizerId}
              eventId={bundle.event.id}
              current={null}
              tone=""
              readOnly={false}
              onConflict={onConflict}
              onDone={() => setAdding(false)}
            />
          </li>
        ) : null}
      </ul>

      <div className="flex flex-wrap items-center gap-4">
        {!adding && !readOnly ? (
          <Button type="button" variant="secondary" onClick={() => setAdding(true)}>
            + Thêm hạng vé
          </Button>
        ) : null}
        {capacity !== null ? (
          <>
            <span className="text-base">
              Tổng {total.toLocaleString("vi-VN")} / {capacity.toLocaleString("vi-VN")} chỗ
            </span>
            <div
              role="img"
              aria-label={`Đã dùng ${Math.round((total / capacity) * 100)}% sức chứa`}
              className="flex h-3.5 min-w-[160px] flex-[1_1_200px] overflow-hidden rounded-full bg-card"
            >
              <div
                className="bg-[#2dc275]"
                style={{ width: `${Math.min(100, (total / capacity) * 100)}%` }}
              />
            </div>
          </>
        ) : null}
      </div>
      {capacity !== null && total > capacity ? (
        <p className="m-0 font-bold">
          Tổng số vé vượt sức chứa địa điểm. Vẫn lưu được, nhưng kiểm tra lại trước khi gửi duyệt.
        </p>
      ) : null}

      <div className="flex justify-between gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          ← Thông tin
        </Button>
        <Button type="button" size="lg" disabled={classes.length === 0} onClick={onNext}>
          Tiếp →
        </Button>
      </div>
    </div>
  );
}

/** Một hạng vé: sửa tại chỗ (giống wireframe), hoặc dòng mới khi `current` null. */
function ClassRow({
  organizerId,
  eventId,
  current,
  tone,
  readOnly,
  onConflict,
  onDone,
}: {
  organizerId: string;
  eventId: string;
  current: TicketClass | null;
  tone: string;
  readOnly: boolean;
  onConflict: (message: string) => void;
  onDone?: () => void;
}) {
  const { create, update, remove } = useTicketClassMutations(organizerId, eventId);
  const [form, setForm] = useState<TicketClassForm>(current ? toForm(current) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const parsed = TicketClassSchema.safeParse(form);
  const dirty = current
    ? !parsed.success ||
      parsed.data.name !== current.name ||
      parsed.data.kind !== current.kind ||
      parsed.data.price_vnd !== current.price_vnd ||
      parsed.data.capacity !== current.capacity
    : true;
  const busy = create.isPending || update.isPending || remove.isPending;
  const label = current?.name ?? "hạng mới";

  const onError = (error: unknown) => {
    if (isVersionConflict(error)) onConflict(organizerErrorMessage(error));
    else setApiError(organizerErrorMessage(error));
  };

  const save = () => {
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setApiError(null);
    if (current) {
      update.mutate(
        { id: current.id, body: { ...parsed.data, version: current.version } },
        { onError },
      );
    } else {
      create.mutate(parsed.data, {
        onSuccess: () => {
          setForm(EMPTY);
          onDone?.();
        },
        onError,
      });
    }
  };

  const maxRevenue =
    parsed.success && parsed.data.price_vnd > 0
      ? formatCompactVnd(parsed.data.price_vnd * parsed.data.capacity)
      : null;

  return (
    <div
      role="group"
      aria-label={current ? `Hạng ${label}` : "Hạng vé mới"}
      className={cn(
        "flex flex-col",
        current ? "bg-card" : "border-[3px] border-dashed border-foreground",
      )}
    >
      <div className="flex">
        {current ? <div aria-hidden="true" className={cn("w-3.5 shrink-0", tone)} /> : null}
        <fieldset
          disabled={readOnly}
          className="m-0 grid min-w-0 flex-1 gap-3.5 border-0 p-4 sm:grid-cols-2 md:p-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.8fr)]"
        >
          <TextField
            label="Tên hạng"
            value={form.name}
            maxLength={128}
            placeholder="Ví dụ: VIP"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
          />
          <SelectField
            label="Loại"
            value={form.kind}
            onChange={(e) =>
              setForm({ ...form, kind: e.target.value === "SEATED" ? "SEATED" : "GA" })
            }
          >
            <option value="GA">{KIND_LABEL.GA}</option>
            <option value="SEATED">{KIND_LABEL.SEATED}</option>
          </SelectField>
          <TextField
            label="Giá (VND)"
            inputMode="numeric"
            value={form.price_vnd}
            onChange={(e) => setForm({ ...form, price_vnd: e.target.value })}
            error={errors.price_vnd}
          />
          <TextField
            label="Số lượng"
            inputMode="numeric"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value })}
            error={errors.capacity}
          />
        </fieldset>
        {current ? (
          <div className="hidden w-[130px] shrink-0 flex-col items-center justify-center border-l-[3px] border-dashed border-foreground px-2 text-center md:flex">
            <span className="text-xs font-semibold">Doanh thu tối đa</span>
            <b className="text-base">{maxRevenue ?? "—"}</b>
          </div>
        ) : null}
      </div>
      {readOnly ? null : (
        <div className="flex flex-wrap items-center gap-3 px-4 pb-4 md:px-5">
          {dirty ? (
            <Button type="button" size="sm" onClick={save} disabled={busy}>
              {busy ? "Đang lưu…" : current ? `Lưu ${label}` : "Lưu hạng vé"}
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
              Xóa {label}
            </Button>
          ) : null}
          {!current && onDone ? (
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
