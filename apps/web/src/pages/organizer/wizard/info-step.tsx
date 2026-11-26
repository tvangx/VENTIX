import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { useCreateVenue, useSaveEvent, useVenues, type EventBundle } from "@/lib/organizer/api";
import { isVersionConflict, organizerErrorMessage } from "@/lib/organizer/errors";
import {
  EventInfoSchema,
  fieldErrors,
  utcToVnLocal,
  vnLocalToUtc,
  VenueFormSchema,
  type EventInfoForm,
  type VenueForm,
} from "@/lib/organizer/forms";
import { FormAlert, SelectField, StepHeading, TextAreaField, TextField } from "./form-parts";

interface Props {
  organizerId: string;
  bundle: EventBundle | undefined;
  readOnly: boolean;
  onConflict: (message: string) => void;
  onSaved: (eventId: string, created: boolean) => void;
}

function initial(bundle: EventBundle | undefined): EventInfoForm {
  const e = bundle?.event;
  return {
    venue_id: e?.venue_id ?? "",
    title: e?.title ?? "",
    description: e?.description ?? "",
    start_local: e ? utcToVnLocal(e.start_at) : "",
    end_local: e ? utcToVnLocal(e.end_at) : "",
  };
}

export function InfoStep({ organizerId, bundle, readOnly, onConflict, onSaved }: Props) {
  const venues = useVenues(organizerId);
  const save = useSaveEvent(organizerId);
  const [form, setForm] = useState<EventInfoForm>(() => initial(bundle));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [addingVenue, setAddingVenue] = useState(false);

  const set = (field: keyof EventInfoForm) => (value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = EventInfoSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setApiError(null);
    const v = parsed.data;
    const fields = {
      venue_id: v.venue_id,
      title: v.title,
      description: v.description,
      start_at: vnLocalToUtc(v.start_local) ?? "",
      end_at: vnLocalToUtc(v.end_local) ?? "",
    };
    const input = bundle
      ? { id: bundle.event.id, body: { ...fields, version: bundle.event.version } }
      : { id: undefined, body: fields };
    save.mutate(input, {
      onSuccess: (event) => onSaved(event.id, !bundle),
      onError: (error) => {
        if (isVersionConflict(error)) onConflict(organizerErrorMessage(error));
        else setApiError(organizerErrorMessage(error));
      },
    });
  };

  const venue = venues.data?.find((item) => item.id === form.venue_id);

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <StepHeading title="Thông tin sự kiện">
        Giờ nhập theo giờ Việt Nam. Sự kiện được lưu ở dạng bản nháp, chỉ bạn thấy cho tới khi Admin
        duyệt.
      </StepHeading>
      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0">
        <TextField
          label="Tên sự kiện"
          value={form.title}
          maxLength={255}
          onChange={(e) => set("title")(e.target.value)}
          error={errors.title}
        />
        <TextAreaField
          label="Mô tả"
          value={form.description}
          maxLength={10000}
          onChange={(e) => set("description")(e.target.value)}
          error={errors.description}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Bắt đầu"
            type="datetime-local"
            value={form.start_local}
            onChange={(e) => set("start_local")(e.target.value)}
            error={errors.start_local}
          />
          <TextField
            label="Kết thúc"
            type="datetime-local"
            value={form.end_local}
            onChange={(e) => set("end_local")(e.target.value)}
            error={errors.end_local}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            label="Địa điểm"
            className="flex-[1_1_280px]"
            value={form.venue_id}
            onChange={(e) => set("venue_id")(e.target.value)}
            error={errors.venue_id}
            hint={
              venue
                ? `${venue.address} · sức chứa ${venue.capacity.toLocaleString("vi-VN")}`
                : undefined
            }
          >
            <option value="">{venues.isPending ? "Đang tải địa điểm…" : "Chọn địa điểm"}</option>
            {venues.data?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </SelectField>
          {!addingVenue ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setAddingVenue(true)}>
              + Địa điểm mới
            </Button>
          ) : null}
        </div>
      </fieldset>
      {addingVenue && !readOnly ? (
        <NewVenue
          organizerId={organizerId}
          onCancel={() => setAddingVenue(false)}
          onCreated={(venueId) => {
            set("venue_id")(venueId);
            setAddingVenue(false);
          }}
        />
      ) : null}
      <FormAlert message={apiError} />
      {readOnly ? null : (
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={save.isPending}>
            {save.isPending ? "Đang lưu…" : "Lưu và tiếp: Hạng vé →"}
          </Button>
        </div>
      )}
    </form>
  );
}

/** Tạo địa điểm ngay trong bước 1. Không lồng form (HTML cấm) nên dùng nút thường. */
function NewVenue({
  organizerId,
  onCancel,
  onCreated,
}: {
  organizerId: string;
  onCancel: () => void;
  onCreated: (venueId: string) => void;
}) {
  const create = useCreateVenue(organizerId);
  const [form, setForm] = useState<VenueForm>({ name: "", address: "", capacity: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);

  const submit = () => {
    const parsed = VenueFormSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setApiError(null);
    create.mutate(parsed.data, {
      onSuccess: (venue) => onCreated(venue.id),
      onError: (error) => setApiError(organizerErrorMessage(error)),
    });
  };

  return (
    <div
      role="group"
      aria-label="Địa điểm mới"
      className="flex flex-col gap-4 border-[3px] border-dashed border-foreground p-4"
    >
      <b className="text-lg">Địa điểm mới</b>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,0.8fr)]">
        <TextField
          label="Tên địa điểm"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          error={errors.name}
        />
        <TextField
          label="Địa chỉ"
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          error={errors.address}
        />
        <TextField
          label="Sức chứa"
          inputMode="numeric"
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: e.target.value })}
          error={errors.capacity}
        />
      </div>
      <FormAlert message={apiError} />
      <div className="flex flex-wrap gap-3">
        <Button type="button" size="sm" onClick={submit} disabled={create.isPending}>
          {create.isPending ? "Đang lưu…" : "Lưu địa điểm"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Hủy
        </Button>
      </div>
    </div>
  );
}
