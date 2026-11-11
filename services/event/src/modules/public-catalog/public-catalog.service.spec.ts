import { matchesEtag, responseEtag } from "./public-catalog.service";
import { catalogDetailKey, catalogListKey } from "./catalog-cache";

describe("S-204 catalog cache keys and validators", () => {
  it("uses a stable bounded list key and event hash tag for detail", () => {
    expect(catalogListKey({ q: "Concert", cursor: undefined, limit: 20 })).toBe(
      catalogListKey({ q: "concert", cursor: undefined, limit: 20 }),
    );
    expect(catalogListKey({ q: "concert", cursor: undefined, limit: 20 })).not.toBe(
      catalogListKey({ q: "concert", cursor: undefined, limit: 21 }),
    );
    expect(catalogDetailKey("abc")).toBe("catalog:{evt:abc}:detail");
  });

  it("uses deterministic ETags and accepts standard If-None-Match forms", () => {
    const tag = responseEtag({ id: "a", version: 1 });
    expect(tag).toBe(responseEtag({ id: "a", version: 1 }));
    expect(tag).not.toBe(responseEtag({ id: "a", version: 2 }));
    expect(matchesEtag(`"other", W/${tag}`, tag)).toBe(true);
    expect(matchesEtag("*", tag)).toBe(true);
    expect(matchesEtag('"other"', tag)).toBe(false);
  });
});
