import { ApiProperty } from "@nestjs/swagger";
import type {
  Event,
  Prisma,
  SalePhase,
  SeatMap,
  TicketClass,
  Venue,
} from "../../../generated/client";
import { MAX_DB_INT, type PageQuery } from "./organizer.dto";

class ResourceResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ minimum: 0 }) version!: number;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty({ format: "date-time" }) updated_at!: string;
}

function resource(row: { id: string; version: number; createdAt: Date; updatedAt: Date }) {
  return {
    id: row.id,
    version: row.version,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function page<Row extends { id: string }, Item>(
  rows: Row[],
  query: PageQuery,
  map: (row: Row) => Item,
) {
  const items = rows.slice(0, query.limit);
  return {
    items: items.map(map),
    next_cursor: rows.length > query.limit ? items.at(-1)!.id : null,
  };
}

export class VenueResponse extends ResourceResponse {
  @ApiProperty({ format: "uuid" }) organizer_id!: string;
  @ApiProperty({ maxLength: 255 }) name!: string;
  @ApiProperty({ maxLength: 512 }) address!: string;
  @ApiProperty({ minimum: 1, maximum: MAX_DB_INT }) capacity!: number;
}

export class VenuePage {
  @ApiProperty({ type: [VenueResponse] }) items!: VenueResponse[];
  @ApiProperty({ type: String, format: "uuid", nullable: true }) next_cursor!: string | null;
}

export function venueResponse(row: Venue) {
  return {
    ...resource(row),
    name: row.name,
    address: row.address,
    capacity: row.capacity,
    organizer_id: row.organizerId,
  };
}

export class EventResponse extends ResourceResponse {
  @ApiProperty({ format: "uuid" }) organizer_id!: string;
  @ApiProperty({
    enum: ["DRAFT", "PENDING", "APPROVED", "REJECTED", "PUBLISHED", "ENDED", "CANCELLED"],
  })
  status!: string;
  @ApiProperty({ format: "uuid" }) venue_id!: string;
  @ApiProperty({ maxLength: 255 }) title!: string;
  @ApiProperty({ maxLength: 10000 }) description!: string;
  @ApiProperty({ type: String, maxLength: 512, nullable: true }) banner_key!: string | null;
  @ApiProperty({ format: "date-time" }) start_at!: string;
  @ApiProperty({ format: "date-time" }) end_at!: string;
}

export class EventPage {
  @ApiProperty({ type: [EventResponse] }) items!: EventResponse[];
  @ApiProperty({ type: String, format: "uuid", nullable: true }) next_cursor!: string | null;
}

export function eventResponse(row: Event) {
  return {
    ...resource(row),
    organizer_id: row.organizerId,
    venue_id: row.venueId,
    title: row.title,
    description: row.description,
    banner_key: row.bannerKey,
    status: row.status,
    start_at: row.startAt.toISOString(),
    end_at: row.endAt.toISOString(),
  };
}

export class SeatMapResponse extends ResourceResponse {
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty({ type: "object", additionalProperties: true }) layout!: object;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) published_at!: string | null;
}

export class SeatMapPage {
  @ApiProperty({ type: [SeatMapResponse] }) items!: SeatMapResponse[];
  @ApiProperty({ type: String, format: "uuid", nullable: true }) next_cursor!: string | null;
}

export function seatMapResponse(row: SeatMap) {
  return {
    ...resource(row),
    event_id: row.eventId,
    layout: row.layout as Prisma.JsonObject,
    published_at: row.publishedAt?.toISOString() ?? null,
  };
}

export class TicketClassResponse extends ResourceResponse {
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty({ maxLength: 128 }) name!: string;
  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }) price_vnd!: number;
  @ApiProperty({ minimum: 1, maximum: MAX_DB_INT }) capacity!: number;
  @ApiProperty({ enum: ["SEATED", "GA"] }) kind!: string;
}

export class TicketClassPage {
  @ApiProperty({ type: [TicketClassResponse] }) items!: TicketClassResponse[];
  @ApiProperty({ type: String, format: "uuid", nullable: true }) next_cursor!: string | null;
}

export function ticketClassResponse(row: TicketClass) {
  return {
    ...resource(row),
    event_id: row.eventId,
    name: row.name,
    price_vnd: Number(row.priceVnd),
    capacity: row.capacity,
    kind: row.kind,
  };
}

export class SalePhaseResponse extends ResourceResponse {
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty({ format: "date-time" }) starts_at!: string;
  @ApiProperty({ format: "date-time" }) ends_at!: string;
  @ApiProperty({ type: Boolean }) queue_enabled!: boolean;
  @ApiProperty({ minimum: 1, maximum: MAX_DB_INT }) admit_rate!: number;
  @ApiProperty({ minimum: 1, maximum: MAX_DB_INT }) per_user_limit!: number;
  @ApiProperty({ type: Boolean }) require_kyc!: boolean;
}

export class SalePhasePage {
  @ApiProperty({ type: [SalePhaseResponse] }) items!: SalePhaseResponse[];
  @ApiProperty({ type: String, format: "uuid", nullable: true }) next_cursor!: string | null;
}

export function salePhaseResponse(row: SalePhase) {
  return {
    ...resource(row),
    event_id: row.eventId,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    queue_enabled: row.queueEnabled,
    admit_rate: row.admitRate,
    per_user_limit: row.perUserLimit,
    require_kyc: row.requireKyc,
  };
}
