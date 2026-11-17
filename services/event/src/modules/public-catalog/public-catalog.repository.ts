import { Injectable } from "@nestjs/common";
import { Prisma, type Event } from "../../../generated/client";
import { PrismaService } from "../../db/prisma.service";
import type { CatalogCursor } from "./catalog-cursor";
import type { CatalogQuery } from "./public-catalog.dto";

export interface CatalogSaleWindow {
  starts_at: string;
  ends_at: string;
  queue_enabled: boolean;
}

interface CatalogRow extends Event {
  venueName: string;
  venueAddress: string;
  minPrice: bigint | null;
  startCursor: string;
  windows: CatalogSaleWindow[];
}

const orderBy = {
  id: Prisma.sql`e.id ASC`,
  start_at: Prisma.sql`e.start_at ASC, e.id ASC`,
  price_asc: Prisma.sql`minimum_price ASC NULLS LAST, e.id ASC`,
};

function cursorFilter(cursor: CatalogCursor) {
  if (cursor.sort === "start_at") {
    return Prisma.sql`(e.start_at, e.id) >
      (${cursor.startsAt}::timestamptz, ${cursor.id}::uuid)`;
  }
  if (cursor.sort === "price_asc") {
    return Prisma.sql`(COALESCE(price.minimum_price, 9223372036854775807), e.id) > (
      COALESCE(${cursor.price}::bigint, 9223372036854775807), ${cursor.id}::uuid
    )`;
  }
  return Prisma.sql`e.id > ${cursor.id}::uuid`;
}

@Injectable()
export class PublicCatalogRepository {
  constructor(private readonly db: PrismaService) {}

  list(query: CatalogQuery, now: Date, cursor?: CatalogCursor) {
    const sort = query.sort ?? "id";
    const filters = [Prisma.sql`e.status = 'PUBLISHED'`];
    if (query.q) {
      const pattern = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      filters.push(
        Prisma.sql`(e.title ILIKE ${pattern} OR v.name ILIKE ${pattern} OR v.address ILIKE ${pattern})`,
      );
    }
    if (cursor) filters.push(cursorFilter(cursor));
    if (query.start_from) filters.push(Prisma.sql`e.start_at >= ${query.start_from}::timestamptz`);
    if (query.start_before)
      filters.push(Prisma.sql`e.start_at < ${query.start_before}::timestamptz`);
    if (query.min_price_vnd !== undefined)
      filters.push(Prisma.sql`price.minimum_price >= ${BigInt(query.min_price_vnd)}`);
    if (query.max_price_vnd !== undefined)
      filters.push(Prisma.sql`price.minimum_price <= ${BigInt(query.max_price_vnd)}`);
    if (query.sale_status) {
      const open = Prisma.sql`EXISTS (
        SELECT 1 FROM sale_phases sp WHERE sp.event_id = e.id
        AND sp.starts_at <= ${now}::timestamptz AND sp.ends_at > ${now}::timestamptz
      )`;
      const upcoming = Prisma.sql`EXISTS (
        SELECT 1 FROM sale_phases sp WHERE sp.event_id = e.id AND sp.starts_at > ${now}::timestamptz
      )`;
      const saleFilters = {
        ON_SALE: open,
        UPCOMING: Prisma.sql`NOT ${open} AND ${upcoming}`,
        CLOSED: Prisma.sql`NOT ${open} AND NOT ${upcoming}`,
      };
      filters.push(saleFilters[query.sale_status]);
    }

    return this.db.$queryRaw<CatalogRow[]>(Prisma.sql`
      WITH page AS (
        SELECT e.*, v.name AS venue_name, v.address AS venue_address, price.minimum_price
        FROM events e JOIN venues v ON (v.id, v.organizer_id) = (e.venue_id, e.organizer_id)
        CROSS JOIN LATERAL (
          SELECT MIN(price_vnd) AS minimum_price FROM ticket_classes WHERE event_id = e.id
        ) price
        WHERE ${Prisma.join(filters, " AND ")}
        ORDER BY ${orderBy[sort]}
        LIMIT ${query.limit + 1}
      )
      SELECT e.id, e.organizer_id AS "organizerId", e.venue_id AS "venueId",
             e.title, e.description, e.banner_key AS "bannerKey", e.status, e.version,
             e.start_at AS "startAt", e.end_at AS "endAt",
             e.created_at AS "createdAt", e.updated_at AS "updatedAt",
             e.venue_name AS "venueName", e.venue_address AS "venueAddress",
             e.minimum_price AS "minPrice",
             to_char(e.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "startCursor",
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'starts_at', sp.starts_at, 'ends_at', sp.ends_at, 'queue_enabled', sp.queue_enabled
               ) ORDER BY sp.starts_at, sp.id)
               FROM sale_phases sp WHERE sp.event_id = e.id AND sp.ends_at > ${now}::timestamptz
             ), '[]'::jsonb) AS windows
      FROM page e
      ORDER BY ${orderBy[sort]}
    `);
  }

  detail(id: string) {
    return this.db.event.findFirst({
      where: { id, status: "PUBLISHED" },
      include: {
        venue: true,
        ticketClasses: { orderBy: { id: "asc" } },
        salePhases: { orderBy: [{ startsAt: "asc" }, { id: "asc" }] },
        seatMaps: { where: { publishedAt: { not: null } }, orderBy: { version: "desc" }, take: 1 },
      },
    });
  }

  async publishedIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.db.event.findMany({
      where: { id: { in: ids }, status: "PUBLISHED" },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }
}
