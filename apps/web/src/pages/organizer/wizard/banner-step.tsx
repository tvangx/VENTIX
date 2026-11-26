import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUploadBanner } from "@/lib/organizer/api";
import {
  BANNER_MAX_BYTES,
  BANNER_TYPES,
  checkBannerFile,
  type BannerFileError,
} from "@/lib/organizer/banner-upload";
import { isVersionConflict, organizerErrorMessage } from "@/lib/organizer/errors";
import { FormAlert, StepHeading } from "./form-parts";
import type { StepProps } from "./wizard-page";

// Banner: chọn ảnh → xem trước → tải lên (presign → PUT → confirm, xem lib/organizer/banner-upload.ts).
// Confirm tự gắn `banner_key` vào sự kiện. Bước này không bắt buộc để gửi duyệt.

const FILE_ERROR: Record<BannerFileError, string> = {
  type: "Chỉ nhận ảnh JPEG, PNG hoặc WebP.",
  size: `Ảnh tối đa ${BANNER_MAX_BYTES / 1024 / 1024} MB.`,
  empty: "Tệp ảnh rỗng.",
};

interface Props extends StepProps {
  preview: string | null;
  onPreview: (objectUrl: string | null) => void;
}

export function BannerStep({
  organizerId,
  bundle,
  readOnly,
  onNext,
  onBack,
  onConflict,
  preview,
  onPreview,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const uploadBanner = useUploadBanner(organizerId);
  const upload = () => {
    if (!file) return;
    uploadBanner.mutate(
      { eventId: bundle.event.id, file, version: bundle.event.version },
      {
        onSuccess: () => setFile(null),
        onError: (error) => {
          if (isVersionConflict(error)) onConflict(organizerErrorMessage(error));
          else setApiError(organizerErrorMessage(error));
        },
      },
    );
  };

  const pick = (picked: File | undefined) => {
    setApiError(null);
    if (!picked) return;
    const error = checkBannerFile(picked);
    if (error) {
      setFile(null);
      setFileError(FILE_ERROR[error]);
      return;
    }
    setFileError(null);
    setFile(picked);
    onPreview(URL.createObjectURL(picked));
  };

  const hasBanner = bundle.event.banner_key !== null;

  return (
    <div className="flex flex-col gap-5">
      <StepHeading title="Banner">
        Ảnh ngang tỉ lệ 16:9 (ví dụ 1600×900), JPEG, PNG hoặc WebP, tối đa{" "}
        {BANNER_MAX_BYTES / 1024 / 1024} MB. Không bắt buộc để gửi duyệt.
      </StepHeading>

      {preview ? (
        <img
          src={preview}
          alt="Ảnh banner đã chọn"
          className="aspect-[16/9] w-full max-w-2xl bg-card object-cover"
        />
      ) : null}

      <p role="status" className="m-0 font-semibold">
        {hasBanner ? "Sự kiện đã có banner." : "Sự kiện chưa có banner."}
        {file ? ` Ảnh “${file.name}” chưa tải lên.` : ""}
      </p>

      {readOnly ? null : (
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-sm font-semibold">
            Chọn ảnh banner
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={BANNER_TYPES.join(",")}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? `${inputId}-error` : undefined}
            onChange={(e) => pick(e.target.files?.[0])}
            className="max-w-full cursor-pointer text-base file:mr-4 file:h-11 file:cursor-pointer file:rounded-full file:border-2 file:border-current file:bg-transparent file:px-5 file:font-bold file:text-foreground"
          />
          {fileError ? (
            <p id={`${inputId}-error`} className="m-0 text-sm font-bold">
              {fileError}
            </p>
          ) : null}
        </div>
      )}
      <FormAlert message={apiError} />

      <div className="flex flex-wrap justify-between gap-3">
        <Button type="button" variant="outline" size="lg" onClick={onBack}>
          ← Đợt mở bán
        </Button>
        <div className="flex flex-wrap gap-3">
          {file && !readOnly ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={uploadBanner.isPending}
              onClick={upload}
            >
              {uploadBanner.isPending ? "Đang tải lên…" : "Tải ảnh lên"}
            </Button>
          ) : null}
          <Button type="button" size="lg" onClick={onNext} disabled={uploadBanner.isPending}>
            {hasBanner || file ? "Tiếp: Gửi duyệt →" : "Bỏ qua, tiếp: Gửi duyệt →"}
          </Button>
        </div>
      </div>
    </div>
  );
}
