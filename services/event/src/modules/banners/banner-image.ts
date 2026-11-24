import sharp from "sharp";
import { ProblemException } from "@ticketing/common";
import { BANNER_MAX_EDGE, THUMBNAIL_MAX_EDGE } from "./banner-file";

/** Chặn decompression bomb: ảnh giải nén quá số điểm ảnh này bị từ chối (~40 MP). */
const MAX_INPUT_PIXELS = 40_000_000;

export interface ProcessedBanner {
  banner: Buffer;
  thumbnail: Buffer;
}

async function toWebp(input: Buffer, edge: number, quality: number): Promise<Buffer> {
  // `rotate()` áp EXIF orientation; sharp mặc định bỏ metadata (EXIF/GPS) khỏi đầu ra.
  return sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
    .rotate()
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
}

/** Giải mã ảnh người dùng gửi, xuất WebP đã bỏ metadata và thumbnail. */
export async function processBanner(input: Buffer): Promise<ProcessedBanner> {
  try {
    const [banner, thumbnail] = await Promise.all([
      toWebp(input, BANNER_MAX_EDGE, 82),
      toWebp(input, THUMBNAIL_MAX_EDGE, 75),
    ]);
    return { banner, thumbnail };
  } catch {
    throw new ProblemException("INVALID_IMAGE_CONTENT", 400, "Không giải mã được ảnh tải lên");
  }
}
