import type { EventSchemas } from "@/lib/api";
import { seedVenues } from "./seed";

// Dữ liệu organizer của mock event-service (venue, sự kiện nháp, hạng vé, đợt bán, seat map).
// Tách khỏi seed công khai: sự kiện tạo bằng wizard không tự hiện trên catalog (cần Admin duyệt và
// publish, làm ở task sau).

type S = EventSchemas["schemas"];
export type MockVenue = S["VenueResponse"];
export type MockOrgEvent = S["EventResponse"];
export type MockTicketClass = S["TicketClassResponse"];
export type MockSalePhase = S["SalePhaseResponse"];
export type MockSeatMap = S["SeatMapResponse"];

export interface MockBannerUpload {
  organizerId: string;
  eventId: string;
  contentType: string;
  size: number;
  bytes: Uint8Array | null;
}

export interface OrganizerMockState {
  venues: Map<string, MockVenue>;
  events: Map<string, MockOrgEvent>;
  ticketClasses: Map<string, MockTicketClass>;
  salePhases: Map<string, MockSalePhase>;
  seatMaps: Map<string, MockSeatMap>;
  /** Banner (S-201b): lượt presign theo upload_id; `bytes` có sau khi PUT vào staging. */
  bannerStaging: Map<string, MockBannerUpload>;
  /** Object công khai `public/events/...` (mock giữ nguyên byte, không đổi sang WebP). */
  bannerPublic: Map<string, { contentType: string; bytes: Uint8Array }>;
}

const SEED_TIME = "2026-10-01T00:00:00.000Z";

/** Venue seed thuộc organizer demo (seed V-104 chỉ có một organizer). */
export function initialOrganizerState(organizerId: string): OrganizerMockState {
  return {
    venues: new Map(
      seedVenues.map((venue) => [
        venue.id,
        {
          ...venue,
          organizer_id: organizerId,
          version: 0,
          created_at: SEED_TIME,
          updated_at: SEED_TIME,
        },
      ]),
    ),
    events: new Map(),
    ticketClasses: new Map(),
    salePhases: new Map(),
    seatMaps: new Map(),
    bannerStaging: new Map(),
    bannerPublic: new Map(),
  };
}
