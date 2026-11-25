import { randomUUID } from "node:crypto";

export const BANNER_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type BannerContentType = (typeof BANNER_CONTENT_TYPES)[number];

/** Số byte đầu cần đọc để nhận dạng định dạng (WebP cần 12). */
export const BANNER_SNIFF_BYTES = 12;

/** Cạnh dài tối đa của banner và thumbnail sau khi xử lý (px). */
export const BANNER_MAX_EDGE = 1920;
export const THUMBNAIL_MAX_EDGE = 480;

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const JPEG_MAGIC = Buffer.from([255, 216, 255]);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PUBLIC_BANNER = new RegExp(`^public/events/${UUID}/${UUID}\\.webp$`);

export function isBannerContentType(value: string): value is BannerContentType {
  return (BANNER_CONTENT_TYPES as readonly string[]).includes(value);
}

/** Khóa staging không công khai; upload_id do server sinh, client không chọn đường dẫn. */
export function stagingKey(eventId: string, uploadId: string): string {
  return `staging/events/${eventId.toLowerCase()}/${uploadId.toLowerCase()}`;
}

/** Cặp khóa công khai (banner + thumbnail) cho một lần confirm. */
export function newPublicBannerKeys(eventId: string): { banner: string; thumbnail: string } {
  const base = `public/events/${eventId.toLowerCase()}/${randomUUID()}`;
  return { banner: `${base}.webp`, thumbnail: `${base}_thumb.webp` };
}

/** Khóa thumbnail của banner do hệ thống sinh; `null` với khóa cũ/seed không có thumbnail. */
export function thumbnailKeyFor(bannerKey: string | null): string | null {
  return bannerKey && PUBLIC_BANNER.test(bannerKey)
    ? bannerKey.replace(/\.webp$/, "_thumb.webp")
    : null;
}

/** Nhận dạng định dạng theo byte đầu; không tin Content-Type do client gửi. */
export function sniffContentType(head: Buffer): BannerContentType | null {
  return BANNER_CONTENT_TYPES.find((type) => matchesMagicBytes(type, head)) ?? null;
}

/** Kiểm tra byte đầu file khớp định dạng khai báo. */
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

/**
 * Ghép URL công khai từ gốc cấu hình và khóa object. Chỉ khóa `public/` mới công khai;
 * khóa seed (`seed/banners/*`) giữ hành vi V-201 nên trả `null`.
 */
export function publicAssetUrl(baseUrl: string | undefined, key: string | null): string | null {
  if (!baseUrl || !key?.startsWith("public/")) return null;
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/${key.split("/").map(encodeURIComponent).join("/")}`;
}
