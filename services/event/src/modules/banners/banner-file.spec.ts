import {
  bannerKeyContentType,
  bannerPublicUrl,
  isBannerContentType,
  matchesMagicBytes,
  newBannerKey,
} from "./banner-file";

const EVENT = "0b9b7a3e-4c1d-4e2f-9a6b-1d2c3e4f5a6b";
const OTHER_EVENT = "1c0c8b4f-5d2e-4f30-8b7c-2e3d4f5a6b7c";
const FILE = "7f1d6c2a-3b4e-4a5f-8c9d-0e1f2a3b4c5d";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const JPEG = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([1, 2, 3, 4]), Buffer.from("WEBP")]);

describe("S-201b banner file rules", () => {
  it("accepts only JPEG, PNG and WebP", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(isBannerContentType(type)).toBe(true);
    }
    for (const type of ["image/gif", "image/svg+xml", "application/pdf", "text/html", ""]) {
      expect(isBannerContentType(type)).toBe(false);
    }
  });

  it("generates a server-side key under the event and maps it back to the type", () => {
    for (const [type, ext] of [
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"],
    ] as const) {
      const key = newBannerKey(EVENT, type);
      expect(key).toMatch(new RegExp(`^events/${EVENT}/[0-9a-f-]{36}\\.${ext}$`));
      expect(bannerKeyContentType(EVENT, key)).toBe(type);
    }
    expect(newBannerKey(EVENT, "image/png")).not.toBe(newBannerKey(EVENT, "image/png"));
  });

  it("rejects keys of another event, traversal, extra segments and unknown extensions", () => {
    const ok = `events/${EVENT}/${FILE}.png`;
    expect(bannerKeyContentType(EVENT, ok)).toBe("image/png");
    expect(bannerKeyContentType(EVENT.toUpperCase(), ok)).toBe("image/png");
    for (const key of [
      `events/${OTHER_EVENT}/${FILE}.png`,
      `events/${EVENT}/../${OTHER_EVENT}/${FILE}.png`,
      `events/${EVENT}/sub/${FILE}.png`,
      `events/${EVENT}/${FILE}.gif`,
      `events/${EVENT}/${FILE}.png.exe`,
      `events/${EVENT}/not-a-uuid.png`,
      `seed/banners/a.jpg`,
      `organizer-docs/${FILE}.pdf`,
      "",
    ]) {
      expect(bannerKeyContentType(EVENT, key)).toBeNull();
    }
  });

  it("checks magic bytes per declared type, not the declared type alone", () => {
    expect(matchesMagicBytes("image/png", PNG)).toBe(true);
    expect(matchesMagicBytes("image/jpeg", JPEG)).toBe(true);
    expect(matchesMagicBytes("image/webp", WEBP)).toBe(true);
    // Khai báo một loại, nội dung loại khác.
    expect(matchesMagicBytes("image/png", JPEG)).toBe(false);
    expect(matchesMagicBytes("image/jpeg", WEBP)).toBe(false);
    expect(matchesMagicBytes("image/webp", PNG)).toBe(false);
    // HTML/SVG/EXE đội lốt ảnh, rỗng và quá ngắn.
    expect(matchesMagicBytes("image/png", Buffer.from("<svg onload=alert(1)>"))).toBe(false);
    expect(matchesMagicBytes("image/jpeg", Buffer.from("MZ\x90\x00"))).toBe(false);
    expect(matchesMagicBytes("image/png", Buffer.alloc(0))).toBe(false);
    expect(matchesMagicBytes("image/webp", Buffer.from("RIFF"))).toBe(false);
    expect(
      matchesMagicBytes("image/webp", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(8)])),
    ).toBe(false);
  });

  it("builds the public URL only when both base and key exist and encodes segments", () => {
    const base = "http://localhost:9000/event-banners";
    expect(bannerPublicUrl(base, `events/${EVENT}/${FILE}.png`)).toBe(
      `${base}/events/${EVENT}/${FILE}.png`,
    );
    expect(bannerPublicUrl(`${base}//`, "a/b.png")).toBe(`${base}/a/b.png`);
    expect(bannerPublicUrl(base, "seed/banners/a b#c.jpg")).toBe(
      `${base}/seed/banners/a%20b%23c.jpg`,
    );
    expect(bannerPublicUrl(undefined, "a.png")).toBeNull();
    expect(bannerPublicUrl(base, null)).toBeNull();
    expect(bannerPublicUrl(base, "")).toBeNull();
  });
});
