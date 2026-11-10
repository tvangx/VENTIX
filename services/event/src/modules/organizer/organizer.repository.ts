import { Injectable } from "@nestjs/common";
import type { Event, Prisma } from "../../../generated/client";
import { PrismaService } from "../../db/prisma.service";
import type {
  CreateEventDto,
  CreateSalePhaseDto,
  CreateTicketClassDto,
  CreateVenueDto,
  PageQuery,
  UpdateEventDto,
  UpdateSalePhaseDto,
  UpdateTicketClassDto,
  UpdateVenueDto,
} from "./organizer.dto";
import { checkEditable, checkRange, checkVersion, notFound } from "./organizer-writes";

function pageQuery(query: PageQuery) {
  return { take: query.limit + 1, orderBy: { id: "asc" as const } };
}

function after(query: PageQuery) {
  return query.cursor ? { gt: query.cursor } : undefined;
}

function eventData(input: CreateEventDto | UpdateEventDto) {
  return {
    venueId: input.venue_id,
    title: input.title,
    description: input.description,
    bannerKey: input.banner_key,
    startAt: input.start_at === undefined ? undefined : new Date(input.start_at),
    endAt: input.end_at === undefined ? undefined : new Date(input.end_at),
  };
}

function phaseData(input: CreateSalePhaseDto | UpdateSalePhaseDto) {
  return {
    startsAt: input.starts_at === undefined ? undefined : new Date(input.starts_at),
    endsAt: input.ends_at === undefined ? undefined : new Date(input.ends_at),
    queueEnabled: input.queue_enabled,
    admitRate: input.admit_rate,
    perUserLimit: input.per_user_limit,
    requireKyc: input.require_kyc,
  };
}

@Injectable()
export class OrganizerRepository {
  constructor(private readonly db: PrismaService) {}

  listVenues(organizerId: string, query: PageQuery) {
    return this.db.venue.findMany({
      where: { organizerId, id: after(query) },
      ...pageQuery(query),
    });
  }

  venue(organizerId: string, id: string) {
    return this.db.venue.findFirst({ where: { id, organizerId } });
  }

  createVenue(tx: Prisma.TransactionClient, organizerId: string, dto: CreateVenueDto) {
    return tx.venue.create({ data: { ...dto, organizerId } });
  }

  async updateVenue(
    tx: Prisma.TransactionClient,
    organizerId: string,
    id: string,
    dto: UpdateVenueDto,
  ) {
    const { version, ...changes } = dto;
    await this.lockVenueVersion(tx, organizerId, id, version);
    // Giữ trạng thái các event đang gắn venue ổn định cho tới khi cập nhật xong.
    const events = await tx.$queryRaw<{ status: string }[]>`
      SELECT status FROM events
      WHERE venue_id = ${id}::uuid AND organizer_id = ${organizerId}::uuid
      ORDER BY id
      FOR SHARE
    `;
    for (const event of events) checkEditable(event.status);
    return tx.venue.update({
      where: { id, organizerId, version },
      data: { ...changes, version: { increment: 1 } },
    });
  }

  async deleteVenue(
    tx: Prisma.TransactionClient,
    organizerId: string,
    id: string,
    version: number,
  ) {
    await this.lockVenueVersion(tx, organizerId, id, version);
    await tx.venue.delete({ where: { id, organizerId, version } });
    return {};
  }

  listEvents(organizerId: string, query: PageQuery) {
    return this.db.event.findMany({
      where: { organizerId, id: after(query) },
      ...pageQuery(query),
    });
  }

  event(organizerId: string, id: string) {
    return this.db.event.findFirst({ where: { id, organizerId } });
  }

  async createEvent(tx: Prisma.TransactionClient, organizerId: string, dto: CreateEventDto) {
    const startAt = new Date(dto.start_at);
    const endAt = new Date(dto.end_at);
    checkRange(startAt, endAt);
    await this.requireVenue(tx, organizerId, dto.venue_id);
    return tx.event.create({
      data: {
        organizerId,
        venueId: dto.venue_id,
        title: dto.title,
        description: dto.description,
        bannerKey: dto.banner_key,
        startAt,
        endAt,
      },
    });
  }

  async updateEvent(
    tx: Prisma.TransactionClient,
    organizerId: string,
    id: string,
    dto: UpdateEventDto,
  ) {
    const changes = eventData(dto);
    if (changes.venueId !== undefined) await this.requireVenue(tx, organizerId, changes.venueId);
    const current = await this.lockEditableEvent(tx, organizerId, id);
    checkVersion(current.version, dto.version);
    checkRange(changes.startAt ?? current.startAt, changes.endAt ?? current.endAt);
    return tx.event.update({
      where: { id, organizerId, version: dto.version, status: current.status },
      data: { ...changes, version: { increment: 1 } },
    });
  }

  async deleteEvent(
    tx: Prisma.TransactionClient,
    organizerId: string,
    id: string,
    version: number,
  ) {
    const current = await this.lockEditableEvent(tx, organizerId, id);
    checkVersion(current.version, version);
    await tx.event.delete({ where: { id, organizerId, version, status: current.status } });
    return {};
  }

  listTicketClasses(organizerId: string, eventId: string, query: PageQuery) {
    return this.db.ticketClass.findMany({
      where: { eventId, event: { organizerId }, id: after(query) },
      ...pageQuery(query),
    });
  }

  ticketClass(organizerId: string, eventId: string, id: string) {
    return this.db.ticketClass.findFirst({ where: { eventId, id, event: { organizerId } } });
  }

  async createTicketClass(
    tx: Prisma.TransactionClient,
    organizerId: string,
    eventId: string,
    dto: CreateTicketClassDto,
  ) {
    await this.lockEditableEvent(tx, organizerId, eventId);
    return tx.ticketClass.create({
      data: {
        eventId,
        name: dto.name,
        priceVnd: BigInt(dto.price_vnd),
        capacity: dto.capacity,
        kind: dto.kind,
      },
    });
  }

  async updateTicketClass(
    tx: Prisma.TransactionClient,
    organizerId: string,
    eventId: string,
    id: string,
    dto: UpdateTicketClassDto,
  ) {
    await this.lockEditableEvent(tx, organizerId, eventId);
    const current = await tx.ticketClass.findUniqueOrThrow({
      where: { id, eventId },
      select: { version: true },
    });
    checkVersion(current.version, dto.version);
    return tx.ticketClass.update({
      where: { id, eventId, version: dto.version },
      data: {
        name: dto.name,
        priceVnd: dto.price_vnd === undefined ? undefined : BigInt(dto.price_vnd),
        capacity: dto.capacity,
        kind: dto.kind,
        version: { increment: 1 },
      },
    });
  }

  async deleteTicketClass(
    tx: Prisma.TransactionClient,
    organizerId: string,
    eventId: string,
    id: string,
    version: number,
  ) {
    await this.lockEditableEvent(tx, organizerId, eventId);
    const current = await tx.ticketClass.findUniqueOrThrow({
      where: { id, eventId },
      select: { version: true },
    });
    checkVersion(current.version, version);
    await tx.ticketClass.delete({ where: { id, eventId, version } });
    return {};
  }

  listSalePhases(organizerId: string, eventId: string, query: PageQuery) {
    return this.db.salePhase.findMany({
      where: { eventId, event: { organizerId }, id: after(query) },
      ...pageQuery(query),
    });
  }

  salePhase(organizerId: string, eventId: string, id: string) {
    return this.db.salePhase.findFirst({ where: { eventId, id, event: { organizerId } } });
  }

  async createSalePhase(
    tx: Prisma.TransactionClient,
    organizerId: string,
    eventId: string,
    dto: CreateSalePhaseDto,
  ) {
    await this.lockEditableEvent(tx, organizerId, eventId);
    const startsAt = new Date(dto.starts_at);
    const endsAt = new Date(dto.ends_at);
    checkRange(startsAt, endsAt);
    return tx.salePhase.create({
      data: {
        eventId,
        startsAt,
        endsAt,
        queueEnabled: dto.queue_enabled,
        admitRate: dto.admit_rate,
        perUserLimit: dto.per_user_limit,
        requireKyc: dto.require_kyc,
      },
    });
  }

  async updateSalePhase(
    tx: Prisma.TransactionClient,
    organizerId: string,
    eventId: string,
    id: string,
    dto: UpdateSalePhaseDto,
  ) {
    await this.lockEditableEvent(tx, organizerId, eventId);
    const current = await tx.salePhase.findUniqueOrThrow({ where: { id, eventId } });
    checkVersion(current.version, dto.version);
    const changes = phaseData(dto);
    checkRange(changes.startsAt ?? current.startsAt, changes.endsAt ?? current.endsAt);
    return tx.salePhase.update({
      where: { id, eventId, version: dto.version },
      data: { ...changes, version: { increment: 1 } },
    });
  }

  async deleteSalePhase(
    tx: Prisma.TransactionClient,
    organizerId: string,
    eventId: string,
    id: string,
    version: number,
  ) {
    await this.lockEditableEvent(tx, organizerId, eventId);
    const current = await tx.salePhase.findUniqueOrThrow({
      where: { id, eventId },
      select: { version: true },
    });
    checkVersion(current.version, version);
    await tx.salePhase.delete({ where: { id, eventId, version } });
    return {};
  }

  private async requireVenue(tx: Prisma.TransactionClient, organizerId: string, id: string) {
    // Khóa venue trước event để gắn venue và chỉnh sửa địa điểm không chạy chồng nhau.
    const [venue] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM venues
      WHERE id = ${id}::uuid AND organizer_id = ${organizerId}::uuid
      FOR SHARE
    `;
    if (!venue) throw notFound();
  }

  private async lockVenueVersion(
    tx: Prisma.TransactionClient,
    organizerId: string,
    id: string,
    version: number,
  ) {
    const [venue] = await tx.$queryRaw<{ version: number }[]>`
      SELECT version FROM venues
      WHERE id = ${id}::uuid AND organizer_id = ${organizerId}::uuid
      FOR NO KEY UPDATE
    `;
    if (!venue) throw notFound();
    checkVersion(venue.version, version);
  }

  private async lockEditableEvent(tx: Prisma.TransactionClient, organizerId: string, id: string) {
    // Khóa cả khi chỉ sửa bảng con để luồng duyệt không thể đổi trạng thái giữa kiểm tra và ghi.
    const [event] = await tx.$queryRaw<Pick<Event, "status" | "version" | "startAt" | "endAt">[]>`
      SELECT status, version, start_at AS "startAt", end_at AS "endAt"
      FROM events
      WHERE id = ${id}::uuid AND organizer_id = ${organizerId}::uuid
      FOR UPDATE
    `;
    if (!event) throw notFound();
    checkEditable(event.status);
    return event;
  }
}
