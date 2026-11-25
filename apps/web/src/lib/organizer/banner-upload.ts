import axios from "axios";
import type { EventSchemas } from "@/lib/api";
import { organizerApi } from "./tenant";

// Upload banner theo event-service (S-201b/S-605, PR #103), ba bước:
//   1. POST .../events/{eventId}/banner/presign { content_type, size_bytes } → upload_id, URL PUT có chữ ký
//   2. PUT ảnh lên URL đó, kèm đúng các header server trả về (vào khu staging, chưa công khai)
//   3. POST .../events/{eventId}/banner/confirm { upload_id, version } → server kiểm magic bytes,
//      đổi sang WebP + thumbnail, tự gắn `banner_key` và trả `version` mới của sự kiện.

type S = EventSchemas["schemas"];
export type BannerType = S["PresignBannerDto"]["content_type"];
export type BannerResult = S["ConfirmBannerResponse"];

export const BANNER_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const satisfies readonly BannerType[];
/** Kiểm sớm ở trình duyệt; giới hạn thật là `UPLOAD_MAX_BYTES` của server (mặc định 5 MiB). */
export const BANNER_MAX_BYTES = 5 * 1024 * 1024;

export type BannerFileError = "type" | "size" | "empty";

function isBannerType(type: string): type is BannerType {
  return (BANNER_TYPES as readonly string[]).includes(type);
}

export function checkBannerFile(file: File): BannerFileError | null {
  if (!isBannerType(file.type)) return "type";
  if (file.size === 0) return "empty";
  if (file.size > BANNER_MAX_BYTES) return "size";
  return null;
}

const idempotencyKey = () => ({ "Idempotency-Key": crypto.randomUUID() });

/**
 * Tải ảnh lên và gắn làm banner. `version` là phiên bản sự kiện đang xem; kết quả có `version`
 * mới. Ném lỗi axios như các API khác (mã lỗi đọc bằng `toProblem`).
 */
export async function uploadBanner(
  eventId: string,
  file: File,
  version: number,
): Promise<BannerResult> {
  if (!isBannerType(file.type)) throw new Error(`Loại ảnh không hỗ trợ: ${file.type}`);
  const ticket = await organizerApi.post("/v1/organizer/events/{eventId}/banner/presign", {
    path: { eventId },
    body: { content_type: file.type, size_bytes: file.size },
    headers: idempotencyKey(),
  });
  // URL có chữ ký: gửi thẳng bằng axios gốc, không kèm Authorization hay cookie. Đọc thành
  // ArrayBuffer để mọi môi trường gửi đúng byte (kể cả jsdom khi test).
  const bytes = await file.arrayBuffer();
  await axios.request({
    method: ticket.method,
    url: ticket.url,
    data: bytes,
    headers: ticket.headers,
  });
  return organizerApi.post("/v1/organizer/events/{eventId}/banner/confirm", {
    path: { eventId },
    body: { upload_id: ticket.upload_id, version },
    headers: idempotencyKey(),
  });
}
