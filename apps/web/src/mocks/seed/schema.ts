import { z } from "zod";

// Tên trường bám theo ERD event_db (5.2) và merch_db (5.7) trong docs/architecture/architecture-v2.md
// để seed script phía service (S-205, V-204) map thẳng sang bảng.
const id = z.string().uuid();
// Thời gian luôn là UTC (hậu tố Z), không chấp nhận offset.
const utc = z.string().datetime();
const vnd = z.number().int().nonnegative();
const positiveInt = z.number().int().positive();

export const VenueSchema = z.object({
  id,
  name: z.string().min(1),
  address: z.string().min(1),
  capacity: positiveInt,
});

export const TicketClassSchema = z.object({
  id,
  name: z.string().min(1),
  price_vnd: vnd,
  capacity: positiveInt,
  kind: z.enum(["SEATED", "GA"]),
});

export const SalePhaseSchema = z.object({
  id,
  name: z.string().min(1),
  starts_at: utc,
  ends_at: utc,
  queue_enabled: z.boolean(),
  admit_rate: positiveInt,
  per_user_limit: positiveInt,
  require_kyc: z.boolean(),
});

export const EventSchema = z.object({
  id,
  organizer_id: id,
  venue_id: id,
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1),
  description: z.string().min(1),
  // Khóa object (MinIO); bản dev phục vụ từ apps/web/public/<banner_key>.
  banner_key: z.string().regex(/^seed\/banners\/[a-z0-9-]+\.jpg$/),
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "PUBLISHED", "ENDED", "CANCELLED"]),
  start_at: utc,
  end_at: utc,
  version: positiveInt,
  ticket_classes: z.array(TicketClassSchema).min(1),
  sale_phases: z.array(SalePhaseSchema).min(1),
});

export const CategorySchema = z.object({ id, name: z.string().min(1) });

export const ProductSchema = z.object({
  id,
  organizer_id: id,
  event_id: id,
  category_id: id,
  name: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

// Gộp sku + inventory (quan hệ 1-1 trong merch_db) cho gọn; reserved/version luôn bắt đầu từ 0.
export const SkuSchema = z.object({
  id,
  product_id: id,
  sku_code: z.string().regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/),
  attributes: z.record(z.string()),
  price_vnd: vnd,
  on_hand: z.number().int().nonnegative(),
  low_stock_threshold: z.number().int().nonnegative(),
});

export const ComboSchema = z.object({
  id,
  event_id: id,
  ticket_class_id: id,
  name: z.string().min(1),
  discount_pct: z.number().int().min(1).max(100),
  items: z.array(z.object({ sku_id: id, quantity: positiveInt })).min(1),
});

export const MerchSeedSchema = z.object({
  categories: z.array(CategorySchema),
  products: z.array(ProductSchema),
  skus: z.array(SkuSchema),
  combos: z.array(ComboSchema),
});

export const FaqItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  category: z.enum(["mua-ve", "thanh-toan", "ve-va-check-in", "resale", "merch", "tai-khoan"]),
  order: positiveInt,
  question: z.string().min(1),
  answer: z.string().min(1),
});

export const VenuesSeedSchema = z.array(VenueSchema);
export const EventsSeedSchema = z.array(EventSchema);
export const FaqSeedSchema = z.array(FaqItemSchema);

export type SeedVenue = z.infer<typeof VenueSchema>;
export type SeedEvent = z.infer<typeof EventSchema>;
export type SeedTicketClass = z.infer<typeof TicketClassSchema>;
export type SeedSalePhase = z.infer<typeof SalePhaseSchema>;
export type SeedCategory = z.infer<typeof CategorySchema>;
export type SeedProduct = z.infer<typeof ProductSchema>;
export type SeedSku = z.infer<typeof SkuSchema>;
export type SeedCombo = z.infer<typeof ComboSchema>;
export type SeedMerch = z.infer<typeof MerchSeedSchema>;
export type SeedFaqItem = z.infer<typeof FaqItemSchema>;
