import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import type { CancelEventDto, DecideEventDto } from "./event-lifecycle.dto";
import { EventLifecycleRepository } from "./event-lifecycle.repository";
import type { PageQuery, VersionDto } from "./organizer.dto";
import {
  eventResponse,
  page,
  salePhaseResponse,
  seatMapResponse,
  ticketClassResponse,
  venueResponse,
} from "./organizer.responses";
import { notFound, OrganizerWrites } from "./organizer-writes";

@Injectable()
export class EventLifecycleService {
  constructor(
    private readonly repo: EventLifecycleRepository,
    private readonly writes: OrganizerWrites,
  ) {}

  async pending(query: PageQuery) {
    return page(await this.repo.pending(query), query, eventResponse);
  }

  async review(id: string) {
    const event = await this.repo.review(id);
    if (!event) throw notFound();
    return {
      ...eventResponse(event),
      venue: venueResponse(event.venue),
      ticket_classes: event.ticketClasses.map(ticketClassResponse),
      sale_phases: event.salePhases.map(salePhaseResponse),
      seat_map: event.seatMaps[0] ? seatMapResponse(event.seatMaps[0]) : null,
    };
  }

  submit(tenant: string, id: string, dto: VersionDto, key?: string) {
    return this.writes.run(tenant, key, "event.submit/" + id, dto, async (tx) =>
      eventResponse(await this.repo.submit(tx, tenant, id, dto.version)),
    );
  }

  async decide(id: string, adminId: string, dto: DecideEventDto, key?: string) {
    if (dto.decision === "REJECTED" && !dto.reason) {
      throw new ProblemException("REJECTION_REASON_REQUIRED", 400, "Cần lý do từ chối");
    }
    const tenant = await this.repo.owner(id);
    return this.writes.run(tenant, key, "event.decision/" + id + "/" + adminId, dto, async (tx) =>
      eventResponse(await this.repo.decide(tx, tenant, id, adminId, dto)),
    );
  }

  publish(tenant: string, id: string, dto: VersionDto, key?: string) {
    return this.writes.run(tenant, key, "event.publish/" + id, dto, async (tx) =>
      eventResponse(await this.repo.publish(tx, tenant, id, dto.version)),
    );
  }

  cancel(tenant: string, id: string, dto: CancelEventDto, key?: string) {
    return this.writes.run(tenant, key, "event.cancel/" + id, dto, async (tx) =>
      eventResponse(await this.repo.cancel(tx, tenant, id, dto.version, dto.reason)),
    );
  }
}
