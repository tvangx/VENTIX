import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import type {
  CreateVenueDto,
  UpdateVenueDto,
  CreateEventDto,
  UpdateEventDto,
  CreateTicketClassDto,
  UpdateTicketClassDto,
  CreateSalePhaseDto,
  CreateSeatMapDto,
  UpdateSalePhaseDto,
  PageQuery,
} from "./organizer.dto";
import {
  venueResponse,
  eventResponse,
  ticketClassResponse,
  salePhaseResponse,
  seatMapResponse,
  page,
} from "./organizer.responses";
import { OrganizerRepository } from "./organizer.repository";
import { OrganizerWrites, notFound } from "./organizer-writes";
import { parseSeatMapLayout } from "./seat-map.layout";

function required<T>(row: T | null): T {
  if (!row) throw notFound();
  return row;
}

function requireChanges(dto: object) {
  if (!Object.entries(dto).some(([name, value]) => name !== "version" && value !== undefined)) {
    throw new ProblemException("EMPTY_PATCH", 400, "Cần ít nhất một trường thay đổi");
  }
}

@Injectable()
export class OrganizerService {
  constructor(
    private readonly repo: OrganizerRepository,
    private readonly writes: OrganizerWrites,
  ) {}

  async listSeatMaps(tenant: string, eventId: string, query: PageQuery) {
    required(await this.repo.event(tenant, eventId));
    return page(await this.repo.listSeatMaps(tenant, eventId, query), query, seatMapResponse);
  }

  async getSeatMap(tenant: string, eventId: string, version: number) {
    return seatMapResponse(required(await this.repo.seatMap(tenant, eventId, version)));
  }

  createSeatMap(tenant: string, eventId: string, dto: CreateSeatMapDto, key: string | undefined) {
    const { layout } = parseSeatMapLayout(dto.layout);
    return this.writes.run(
      tenant,
      key,
      "POST events/" + eventId + "/seat-maps",
      layout,
      async (tx) => seatMapResponse(await this.repo.createSeatMap(tx, tenant, eventId, layout)),
      60000,
    );
  }

  async listVenues(tenant: string, query: PageQuery) {
    return page(await this.repo.listVenues(tenant, query), query, venueResponse);
  }

  async getVenue(tenant: string, id: string) {
    return venueResponse(required(await this.repo.venue(tenant, id)));
  }

  createVenue(tenant: string, dto: CreateVenueDto, key: string | undefined) {
    return this.writes.run(tenant, key, "POST " + "venues", dto, async (tx) =>
      venueResponse(await this.repo.createVenue(tx, tenant, dto)),
    );
  }

  updateVenue(tenant: string, id: string, dto: UpdateVenueDto, key: string | undefined) {
    requireChanges(dto);
    return this.writes.run(tenant, key, "PATCH " + "venues" + "/" + id, dto, async (tx) =>
      venueResponse(await this.repo.updateVenue(tx, tenant, id, dto)),
    );
  }

  deleteVenue(tenant: string, id: string, version: number, key: string | undefined) {
    return this.writes.run(tenant, key, "DELETE " + "venues" + "/" + id, { version }, (tx) =>
      this.repo.deleteVenue(tx, tenant, id, version),
    );
  }

  async listEvents(tenant: string, query: PageQuery) {
    return page(await this.repo.listEvents(tenant, query), query, eventResponse);
  }

  async getEvent(tenant: string, id: string) {
    return eventResponse(required(await this.repo.event(tenant, id)));
  }

  createEvent(tenant: string, dto: CreateEventDto, key: string | undefined) {
    return this.writes.run(tenant, key, "POST " + "events", dto, async (tx) =>
      eventResponse(await this.repo.createEvent(tx, tenant, dto)),
    );
  }

  updateEvent(tenant: string, id: string, dto: UpdateEventDto, key: string | undefined) {
    requireChanges(dto);
    return this.writes.run(tenant, key, "PATCH " + "events" + "/" + id, dto, async (tx) =>
      eventResponse(await this.repo.updateEvent(tx, tenant, id, dto)),
    );
  }

  deleteEvent(tenant: string, id: string, version: number, key: string | undefined) {
    return this.writes.run(tenant, key, "DELETE " + "events" + "/" + id, { version }, (tx) =>
      this.repo.deleteEvent(tx, tenant, id, version),
    );
  }

  async listTicketClasses(tenant: string, eventId: string, query: PageQuery) {
    required(await this.repo.event(tenant, eventId));
    return page(
      await this.repo.listTicketClasses(tenant, eventId, query),
      query,
      ticketClassResponse,
    );
  }

  async getTicketClass(tenant: string, eventId: string, id: string) {
    return ticketClassResponse(required(await this.repo.ticketClass(tenant, eventId, id)));
  }

  createTicketClass(
    tenant: string,
    eventId: string,
    dto: CreateTicketClassDto,
    key: string | undefined,
  ) {
    return this.writes.run(
      tenant,
      key,
      "POST " + "events/" + eventId + "/ticket-classes",
      dto,
      async (tx) =>
        ticketClassResponse(await this.repo.createTicketClass(tx, tenant, eventId, dto)),
    );
  }

  updateTicketClass(
    tenant: string,
    eventId: string,
    id: string,
    dto: UpdateTicketClassDto,
    key: string | undefined,
  ) {
    requireChanges(dto);
    return this.writes.run(
      tenant,
      key,
      "PATCH " + "events/" + eventId + "/ticket-classes" + "/" + id,
      dto,
      async (tx) =>
        ticketClassResponse(await this.repo.updateTicketClass(tx, tenant, eventId, id, dto)),
    );
  }

  deleteTicketClass(
    tenant: string,
    eventId: string,
    id: string,
    version: number,
    key: string | undefined,
  ) {
    return this.writes.run(
      tenant,
      key,
      "DELETE " + "events/" + eventId + "/ticket-classes" + "/" + id,
      { version },
      (tx) => this.repo.deleteTicketClass(tx, tenant, eventId, id, version),
    );
  }

  async listSalePhases(tenant: string, eventId: string, query: PageQuery) {
    required(await this.repo.event(tenant, eventId));
    return page(await this.repo.listSalePhases(tenant, eventId, query), query, salePhaseResponse);
  }

  async getSalePhase(tenant: string, eventId: string, id: string) {
    return salePhaseResponse(required(await this.repo.salePhase(tenant, eventId, id)));
  }

  createSalePhase(
    tenant: string,
    eventId: string,
    dto: CreateSalePhaseDto,
    key: string | undefined,
  ) {
    return this.writes.run(
      tenant,
      key,
      "POST " + "events/" + eventId + "/sale-phases",
      dto,
      async (tx) => salePhaseResponse(await this.repo.createSalePhase(tx, tenant, eventId, dto)),
    );
  }

  updateSalePhase(
    tenant: string,
    eventId: string,
    id: string,
    dto: UpdateSalePhaseDto,
    key: string | undefined,
  ) {
    requireChanges(dto);
    return this.writes.run(
      tenant,
      key,
      "PATCH " + "events/" + eventId + "/sale-phases" + "/" + id,
      dto,
      async (tx) =>
        salePhaseResponse(await this.repo.updateSalePhase(tx, tenant, eventId, id, dto)),
    );
  }

  deleteSalePhase(
    tenant: string,
    eventId: string,
    id: string,
    version: number,
    key: string | undefined,
  ) {
    return this.writes.run(
      tenant,
      key,
      "DELETE " + "events/" + eventId + "/sale-phases" + "/" + id,
      { version },
      (tx) => this.repo.deleteSalePhase(tx, tenant, eventId, id, version),
    );
  }
}
