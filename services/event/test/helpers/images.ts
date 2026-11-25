import sharp from "sharp";

export type ImageFormat = "jpeg" | "png" | "webp";

/** Ảnh thật, giải mã được, để test pipeline xử lý bằng sharp. */
export async function realImage(format: ImageFormat, width = 64, height = 32): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 90 } },
  });
  return image[format]().toBuffer();
}

export const CONTENT_TYPE: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
