import sharp from "sharp";
import { ProblemException } from "@ticketing/common";
import { processBanner } from "./banner-image";

async function make(format: "jpeg" | "png" | "webp", width: number, height: number) {
  const image = sharp({ create: { width, height, channels: 3, background: "#c81e5a" } });
  return image[format]().toBuffer();
}

describe("S-605 processBanner", () => {
  it.each(["jpeg", "png", "webp"] as const)(
    "converts %s to WebP banner and thumbnail",
    async (f) => {
      const { banner, thumbnail } = await processBanner(await make(f, 3000, 1000));
      const [b, t] = await Promise.all([sharp(banner).metadata(), sharp(thumbnail).metadata()]);
      expect(b).toMatchObject({ format: "webp", width: 1920, height: 640 });
      expect(t).toMatchObject({ format: "webp", width: 480, height: 160 });
    },
  );

  it("never upscales small images", async () => {
    const { banner, thumbnail } = await processBanner(await make("png", 100, 50));
    expect(await sharp(banner).metadata()).toMatchObject({ width: 100, height: 50 });
    expect(await sharp(thumbnail).metadata()).toMatchObject({ width: 100, height: 50 });
  });

  it("applies EXIF orientation and strips metadata", async () => {
    const tagged = await sharp(await make("jpeg", 200, 100))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(tagged).metadata()).orientation).toBe(6);
    const { banner } = await processBanner(tagged);
    const meta = await sharp(banner).metadata();
    expect(meta).toMatchObject({ width: 100, height: 200 });
    expect(meta.exif).toBeUndefined();
  });

  it("rejects bytes that are not a decodable image", async () => {
    await expect(processBanner(Buffer.from("\x89PNG\r\n\x1a\nnot really"))).rejects.toMatchObject({
      constructor: ProblemException,
      status: 400,
      code: "INVALID_IMAGE_CONTENT",
    });
  });

  it("rejects images over the pixel budget (decompression bomb)", async () => {
    const bomb = await sharp({
      create: { width: 8000, height: 6000, channels: 3, background: "#000" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    await expect(processBanner(bomb)).rejects.toMatchObject({ code: "INVALID_IMAGE_CONTENT" });
  });
});
