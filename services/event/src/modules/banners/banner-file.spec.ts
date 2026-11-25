import {
  matchesMagicBytes,
  newPublicBannerKeys,
  publicAssetUrl,
  sniffContentType,
  stagingKey,
  thumbnailKeyFor,
} from "./banner-file";

const EVENT = "0b9b7a3e-4c1d-4e2f-9a6b-1d2c3e4f5a6b";
const UPLOAD = "7f1d6c2a-3b4e-4a5f-8c9d-0e1f2a3b4c5d";
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([4, 0, 0, 0]), Buffer.from("WEBP")]);

describe("S-605 banner-file", () => {
  it("builds a non-public staging key from server values only", () => {
    expect(stagingKey(EVENT.toUpperCase(), UPLOAD)).toBe(`staging/events/${EVENT}/${UPLOAD}`);
  });

  it("issues a public banner key with a matching thumbnail key", () => {
    const keys = newPublicBannerKeys(EVENT);
    expect(keys.banner).toMatch(new RegExp(`^public/events/${EVENT}/[0-9a-f-]{36}\\.webp$`));
    expect(keys.thumbnail).toBe(keys.banner.replace(/\.webp$/, "_thumb.webp"));
    expect(thumbnailKeyFor(keys.banner)).toBe(keys.thumbnail);
    expect(newPublicBannerKeys(EVENT).banner).not.toBe(keys.banner);
  });

  it.each([null, "seed/banners/a.jpg", `events/${EVENT}/${UPLOAD}.webp`, "public/x/../y.webp"])(
    "has no thumbnail for %s",
    (key) => {
      expect(thumbnailKeyFor(key)).toBeNull();
    },
  );

  it("recognises PNG, JPEG and WebP and rejects look-alikes", () => {
    expect(sniffContentType(PNG)).toBe("image/png");
    expect(sniffContentType(JPEG)).toBe("image/jpeg");
    expect(sniffContentType(WEBP)).toBe("image/webp");
    expect(sniffContentType(Buffer.from("<html><script>"))).toBeNull();
    expect(sniffContentType(Buffer.alloc(0))).toBeNull();
    expect(matchesMagicBytes("image/png", JPEG)).toBe(false);
    expect(matchesMagicBytes("image/webp", Buffer.from("RIFF"))).toBe(false);
    expect(
      matchesMagicBytes("image/webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(8)])),
    ).toBe(false);
  });

  it("joins the public base URL and key, encoding each path segment", () => {
    const key = `public/events/${EVENT}/a b.webp`;
    expect(publicAssetUrl("https://cdn.test/event-banners/", key)).toBe(
      `https://cdn.test/event-banners/public/events/${EVENT}/a%20b.webp`,
    );
  });

  it("returns null without a base URL, without a key, or for non-public keys", () => {
    expect(publicAssetUrl(undefined, "public/x.webp")).toBeNull();
    expect(publicAssetUrl("https://cdn.test", null)).toBeNull();
    expect(publicAssetUrl("https://cdn.test", "seed/banners/a.jpg")).toBeNull();
    expect(publicAssetUrl("https://cdn.test", `staging/events/${EVENT}/${UPLOAD}`)).toBeNull();
  });
});
