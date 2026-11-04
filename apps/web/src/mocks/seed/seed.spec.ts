import { describe, expect, it } from "vitest";
import { seedEvents, seedFaq, seedMerch, seedVenues } from "./index";

// Chỉ lấy danh sách file (không nạp nội dung) để kiểm tra banner có tồn tại trong public/.
const bannerFiles = new Set(
  Object.keys(import.meta.glob("../../../public/seed/banners/*.jpg")).map((path) =>
    path.replace("../../../public/", ""),
  ),
);

const byId = <T extends { id: string }>(rows: readonly T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.id, row]));

const venues = byId(seedVenues);
const events = byId(seedEvents);
const ticketClasses = new Map(
  seedEvents.flatMap((e) => e.ticket_classes.map((tc) => [tc.id, { ...tc, event_id: e.id }])),
);
const categories = byId(seedMerch.categories);
const products = byId(seedMerch.products);
const skus = byId(seedMerch.skus);

describe("seed data", () => {
  it("has the content required by V-104", () => {
    expect(seedEvents).toHaveLength(5);
    expect(seedMerch.products.length).toBeGreaterThan(0);
    expect(seedFaq.length).toBeGreaterThan(0);
  });

  it("uses globally unique ids", () => {
    const ids = [
      ...seedVenues.map((v) => v.id),
      ...seedEvents.flatMap((e) => [
        e.id,
        ...e.ticket_classes.map((tc) => tc.id),
        ...e.sale_phases.map((sp) => sp.id),
      ]),
      ...seedMerch.categories.map((c) => c.id),
      ...seedMerch.products.map((p) => p.id),
      ...seedMerch.skus.map((s) => s.id),
      ...seedMerch.combos.map((c) => c.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses unique slugs, sku codes and faq ids", () => {
    const slugs = seedEvents.map((e) => e.slug);
    const skuCodes = seedMerch.skus.map((s) => s.sku_code);
    const faqIds = seedFaq.map((f) => f.id);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(skuCodes).size).toBe(skuCodes.length);
    expect(new Set(faqIds).size).toBe(faqIds.length);
  });

  describe("events", () => {
    it.each(seedEvents.map((e) => [e.slug, e] as const))("%s is internally consistent", (_, e) => {
      const venue = venues.get(e.venue_id);
      expect(venue).toBeDefined();
      expect(Date.parse(e.start_at)).toBeLessThan(Date.parse(e.end_at));

      const totalCapacity = e.ticket_classes.reduce((sum, tc) => sum + tc.capacity, 0);
      expect(totalCapacity).toBeLessThanOrEqual(venue?.capacity ?? 0);

      for (const phase of e.sale_phases) {
        expect(Date.parse(phase.starts_at)).toBeLessThan(Date.parse(phase.ends_at));
        expect(Date.parse(phase.ends_at)).toBeLessThanOrEqual(Date.parse(e.start_at));
      }
    });

    it("keeps sale phases of an event from overlapping", () => {
      for (const e of seedEvents) {
        const phases = [...e.sale_phases].sort(
          (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
        );
        phases.slice(1).forEach((phase, i) => {
          expect(Date.parse(phase.starts_at)).toBeGreaterThanOrEqual(Date.parse(phases[i].ends_at));
        });
      }
    });

    it("stores all times as UTC", () => {
      const times = seedEvents.flatMap((e) => [
        e.start_at,
        e.end_at,
        ...e.sale_phases.flatMap((sp) => [sp.starts_at, sp.ends_at]),
      ]);
      for (const t of times) {
        expect(t.endsWith("Z")).toBe(true);
      }
    });

    it("has a banner file for every event", () => {
      for (const e of seedEvents) {
        expect(bannerFiles.has(e.banner_key), e.banner_key).toBe(true);
      }
    });

    it("includes a 10,000-seat flash-sale event behind the waiting room", () => {
      const flashSale = seedEvents.filter(
        (e) =>
          e.status === "PUBLISHED" &&
          e.ticket_classes.every((tc) => tc.kind === "SEATED") &&
          e.ticket_classes.reduce((sum, tc) => sum + tc.capacity, 0) === 10_000 &&
          e.sale_phases.every((sp) => sp.queue_enabled && sp.require_kyc),
      );
      expect(flashSale).toHaveLength(1);
    });

    it("covers the non-published states used by the admin flow", () => {
      expect(seedEvents.some((e) => e.status === "PENDING")).toBe(true);
    });
  });

  describe("merch", () => {
    it("links every product to an existing event, category and the event's organizer", () => {
      for (const p of seedMerch.products) {
        const event = events.get(p.event_id);
        expect(event, p.name).toBeDefined();
        expect(categories.has(p.category_id), p.name).toBe(true);
        expect(p.organizer_id, p.name).toBe(event?.organizer_id);
      }
    });

    it("gives every product at least one sku and every sku an existing product", () => {
      for (const s of seedMerch.skus) {
        expect(products.has(s.product_id), s.sku_code).toBe(true);
      }
      for (const p of seedMerch.products) {
        expect(
          seedMerch.skus.some((s) => s.product_id === p.id),
          p.name,
        ).toBe(true);
      }
    });

    it("only sells merch for published events", () => {
      for (const p of seedMerch.products) {
        expect(events.get(p.event_id)?.status, p.name).toBe("PUBLISHED");
      }
    });

    it("ties each combo to a ticket class and skus of the same event", () => {
      for (const combo of seedMerch.combos) {
        expect(ticketClasses.get(combo.ticket_class_id)?.event_id, combo.name).toBe(combo.event_id);
        for (const item of combo.items) {
          const sku = skus.get(item.sku_id);
          const product = sku ? products.get(sku.product_id) : undefined;
          expect(product?.event_id, combo.name).toBe(combo.event_id);
        }
      }
    });
  });

  it("keeps every amount in whole thousands of VND", () => {
    const amounts = [
      ...seedEvents.flatMap((e) => e.ticket_classes.map((tc) => tc.price_vnd)),
      ...seedMerch.skus.map((s) => s.price_vnd),
    ];
    for (const amount of amounts) {
      expect(amount % 1000).toBe(0);
    }
  });

  it("orders faq entries uniquely within each category", () => {
    const keys = seedFaq.map((f) => `${f.category}:${f.order}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
