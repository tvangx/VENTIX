import eventsJson from "./events.json";
import faqJson from "./faq.json";
import merchJson from "./merch.json";
import venuesJson from "./venues.json";
import { EventsSeedSchema, FaqSeedSchema, MerchSeedSchema, VenuesSeedSchema } from "./schema";

// Parse khi nạp module để JSON sửa sai bị phát hiện ngay ở MSW/UI thay vì lỗi ngầm khi render.
export const seedVenues = VenuesSeedSchema.parse(venuesJson);
export const seedEvents = EventsSeedSchema.parse(eventsJson);
export const seedMerch = MerchSeedSchema.parse(merchJson);
export const seedFaq = FaqSeedSchema.parse(faqJson);

/** Đường dẫn ảnh banner khi chạy dev (Vite phục vụ apps/web/public). */
export function bannerUrl(bannerKey: string): string {
  return `/${bannerKey}`;
}

export * from "./schema";
