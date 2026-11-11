import { Injectable } from "@nestjs/common";
import { ProblemException, requestContext } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { fromPrismaTx, OutboxService } from "@ticketing/outbox-inbox";
import type { Event, Prisma } from "../../../generated/client";
import { PrismaService } from "../../db/prisma.service";
import type { DecideEventDto } from "./event-lifecycle.dto";
import type { PageQuery } from "./organizer.dto";
import { checkVersion, notFound } from "./organizer-writes";

type EventState = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "PUBLISHED" | "CANCELLED";

@Injectable()
export class EventLifecycleRepository {
  private readonly outbox = new OutboxService();

  constructor(private readonly db: PrismaService) {}

  pending(query: PageQuery) {
    return this.db.event.findMany({
      where: { status: "PENDING", id: query.cursor ? { gt: query.cursor } : undefined },
      orderBy: { id: "asc" },
      take: query.limit + 1,
    });
  }

  review(id: string) {
    return this.db.event.findUnique({
      where: { id },
      include: {
        venue: true,
        ticketClasses: { orderBy: { id: "asc" } },
        salePhases: { orderBy: [{ startsAt: "asc" }, { id: "asc" }] },
        seatMaps: { orderBy: { version: "desc" }, take: 1 },
      },
    });
  }

  async owner(id: string) {
    const event = await this.db.event.findUnique({ where: { id }, select: { organizerId: true } });
    if (!event) throw notFound();
    return event.organizerId;
  }

  async submit(tx: Prisma.TransactionClient, organizerId: string, id: string, version: number) {
    const { event } = await this.transition(
      tx,
      organizerId,
      id,
      version,
      ["DRAFT", "REJECTED"],
      "PENDING",
    );
    return event;
  }

  async decide(
    tx: Prisma.TransactionClient,
    organizerId: string,
    id: string,
    adminId: string,
    dto: DecideEventDto,
  ) {
    const { event } = await this.transition(
      tx,
      organizerId,
      id,
      dto.version,
      ["PENDING"],
      dto.decision,
    );
    await tx.eventApproval.create({
      data: { eventId: id, adminId, decision: dto.decision, reason: dto.reason },
    });
    return event;
  }

  async publish(tx: Prisma.TransactionClient, organizerId: string, id: string, version: number) {
    const { event } = await this.transition(
      tx,
      organizerId,
      id,
      version,
      ["APPROVED"],
      "PUBLISHED",
    );
    const classes = await tx.ticketClass.findMany({
      where: { eventId: id },
      orderBy: { id: "asc" },
    });
    const phases = await tx.salePhase.findMany({
      where: { eventId: id },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    });
    if (!classes.length || !phases.length) {
      throw new ProblemException(
        "EVENT_CONFIGURATION_INCOMPLETE",
        409,
        "Cần hạng vé và đợt mở bán để publish",
      );
    }
    const seated = new Set(
      classes.filter(({ kind }) => kind === "SEATED").map(({ id: classId }) => classId),
    );
    const seatMapVersion = seated.size ? await this.publishSeatMap(tx, event.id, seated) : 0;
    const snapshot = {
      event_id: event.id,
      organizer_id: event.organizerId,
      title: event.title,
      start_at: event.startAt.toISOString(),
      end_at: event.endAt.toISOString(),
      event_version: event.version,
      seat_map_version: seatMapVersion,
      ticket_classes: classes.map((item) => ({
        id: item.id,
        name: item.name,
        price_vnd: Number(item.priceVnd),
        capacity: item.capacity,
        kind: item.kind,
      })),
      sale_phases: phases.map((phase) => ({
        starts_at: phase.startsAt.toISOString(),
        ends_at: phase.endsAt.toISOString(),
        queue_enabled: phase.queueEnabled,
        admit_rate: phase.admitRate,
        per_user_limit: phase.perUserLimit,
        require_kyc: phase.requireKyc,
      })),
    };
    await this.outbox.add(
      fromPrismaTx(tx),
      newMessage("EventApproved", snapshot, this.envelope(event)),
      event.id,
    );
    return event;
  }

  async cancel(
    tx: Prisma.TransactionClient,
    organizerId: string,
    id: string,
    version: number,
    reason: string,
  ) {
    const { event, previousStatus } = await this.transition(
      tx,
      organizerId,
      id,
      version,
      ["DRAFT", "REJECTED", "PENDING", "APPROVED", "PUBLISHED"],
      "CANCELLED",
    );
    if (previousStatus === "PUBLISHED") {
      await this.outbox.add(
        fromPrismaTx(tx),
        newMessage(
          "EventCancelled",
          {
            event_id: event.id,
            organizer_id: event.organizerId,
            reason,
            event_version: event.version,
          },
          this.envelope(event),
        ),
        event.id,
      );
    }
    return event;
  }

  private async transition(
    tx: Prisma.TransactionClient,
    organizerId: string,
    id: string,
    version: number,
    from: readonly EventState[],
    to: EventState,
  ) {
    const current = await tx.event.findFirst({ where: { id, organizerId } });
    if (!current) throw notFound();
    checkVersion(current.version, version);
    if (!from.some((status) => status === current.status)) {
      throw new ProblemException(
        "EVENT_TRANSITION_NOT_ALLOWED",
        409,
        "Trạng thái sự kiện không cho phép thao tác",
      );
    }
    const updated = await tx.event.updateMany({
      where: { id, organizerId, version, status: current.status },
      data: { status: to, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new ProblemException("VERSION_CONFLICT", 409, "Phiên bản sự kiện đã thay đổi");
    }
    const event = await tx.event.findUniqueOrThrow({ where: { id } });
    return { event, previousStatus: current.status };
  }

  private async publishSeatMap(
    tx: Prisma.TransactionClient,
    eventId: string,
    seated: ReadonlySet<string>,
  ) {
    // Cùng khóa với trigger S-107. Đọc và đánh dấu chính xác một version mà không đua ghi layout.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"seatmap:" + eventId}, 0))::text`;
    const map = await tx.seatMap.findFirst({ where: { eventId }, orderBy: { version: "desc" } });
    if (!map) {
      throw new ProblemException("SEAT_MAP_REQUIRED", 409, "Cần seat map cho hạng vé SEATED");
    }
    const mapped = await tx.seat.groupBy({
      by: ["ticketClassId"],
      where: { eventId, block: { zone: { seatMapId: map.id } } },
    });
    if (
      mapped.length !== seated.size ||
      mapped.some(({ ticketClassId }) => !seated.has(ticketClassId))
    ) {
      throw new ProblemException(
        "SEAT_MAP_CLASS_MISMATCH",
        409,
        "Seat map phải khớp hạng vé SEATED",
      );
    }
    if (!map.publishedAt) {
      await tx.seatMap.update({ where: { id: map.id }, data: { publishedAt: new Date() } });
    }
    return map.version;
  }

  private envelope(event: Event) {
    return { version: 2, tenant_id: event.organizerId, trace_id: requestContext.get()?.traceId };
  }
}
