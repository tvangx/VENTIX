import { randomUUID } from "node:crypto";

export const BANNER_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type BannerContentType = (typeof BANNER_CONTENT_TYPES)[number];

/** Số byte đầu cần đọc để nhận dạng định dạng (WebP cần 12). */
export const BANNER_SNIFF_BYTES = 12;

const EXTENSIONS: Record<BannerContentType, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const BY_EXTENSION: Record<string, BannerContentType> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_MAGIC = Buffer.from([255, 216, 255]);

export function isBannerContentType(value: string): value is BannerContentType {
  return (BANNER_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Khóa object do server sinh: client không bao giờ chọn đường dẫn. */
export function newBannerKey(eventId: string, contentType: BannerContentType): string {
  return `events/${eventId}/${randomUUID()}.${EXTENSIONS[contentType]}`;
}

/**
 * Trả content-type theo đuôi nếu `key` đúng dạng `events/{eventId}/{uuid}.{ext}` của sự kiện này.
 * Mọi khóa khác (sự kiện khác, `..`, đường dẫn con, đuôi lạ) trả `null`.
 */
export function bannerKeyContentType(eventId: string, key: string): BannerContentType | null {
  const match =
    /^events\/([0-9a-f-]{36})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/.exec(
      key,
    );
  if (!match || match[1] !== eventId.toLowerCase()) return null;
  return BY_EXTENSION[match[2]] ?? null;
}

/** Kiểm tra byte đầu file khớp định dạng khai báo, không tin Content-Type do client gửi. */
export function matchesMagicBytes(contentType: BannerContentType, head: Buffer): boolean {
  switch (contentType) {
    case "image/png":
      return (
        head.length >= PNG_MAGIC.length && head.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)
      );
    case "image/jpeg":
      return (
        head.length >= JPEG_MAGIC.length && head.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC)
      );
    case "image/webp":
      return (
        head.length >= BANNER_SNIFF_BYTES &&
        head.subarray(0, 4).toString("latin1") === "RIFF" &&
        head.subarray(8, 12).toString("latin1") === "WEBP"
      );
  }
}

/** Ghép URL công khai từ gốc cấu hình và khóa object; mã hóa từng đoạn đường dẫn. */
export function bannerPublicUrl(baseUrl: string | undefined, key: string | null): string | null {
  if (!baseUrl || !key) return null;
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
