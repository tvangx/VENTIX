import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "@ticketing/auth-guard";
import {
  CreateVenueDto,
  UpdateVenueDto,
  CreateEventDto,
  UpdateEventDto,
  CreateTicketClassDto,
  UpdateTicketClassDto,
  CreateSalePhaseDto,
  UpdateSalePhaseDto,
  DeleteQuery,
  PageQuery,
} from "./organizer.dto";
import {
  VenuePage,
  VenueResponse,
  EventPage,
  EventResponse,
  TicketClassPage,
  TicketClassResponse,
  SalePhasePage,
  SalePhaseResponse,
} from "./organizer.responses";
import { ApiOrganizerErrors, ApiOrganizerWrite, OrganizerId } from "./organizer-http";
import { OrganizerService } from "./organizer.service";

const uuid = new ParseUUIDPipe();

@ApiTags("organizer-venues")
@ApiBearerAuth()
@ApiOrganizerErrors()
@Roles("ORGANIZER")
@Controller("organizer/venues")
export class OrganizerVenuesController {
  constructor(private readonly organizer: OrganizerService) {}

  @Get()
  @ApiOkResponse({ type: VenuePage })
  list(@OrganizerId() tenant: string, @Query() query: PageQuery) {
    return this.organizer.listVenues(tenant, query);
  }

  @Get(":id")
  @ApiOkResponse({ type: VenueResponse })
  get(@OrganizerId() tenant: string, @Param("id", uuid) id: string) {
    return this.organizer.getVenue(tenant, id);
  }

  @Post()
  @ApiOrganizerWrite(201, VenueResponse)
  create(
    @OrganizerId() tenant: string,
    @Body() dto: CreateVenueDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.createVenue(tenant, dto, key);
  }

  @Patch(":id")
  @ApiOrganizerWrite(200, VenueResponse)
  update(
    @OrganizerId() tenant: string,
    @Param("id", uuid) id: string,
    @Body() dto: UpdateVenueDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.updateVenue(tenant, id, dto, key);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOrganizerWrite(204)
  remove(
    @OrganizerId() tenant: string,
    @Param("id", uuid) id: string,
    @Query() query: DeleteQuery,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.deleteVenue(tenant, id, query.version, key);
  }
}

@ApiTags("organizer-events")
@ApiBearerAuth()
@ApiOrganizerErrors()
@Roles("ORGANIZER")
@Controller("organizer/events")
export class OrganizerEventsController {
  constructor(private readonly organizer: OrganizerService) {}

  @Get()
  @ApiOkResponse({ type: EventPage })
  list(@OrganizerId() tenant: string, @Query() query: PageQuery) {
    return this.organizer.listEvents(tenant, query);
  }

  @Get(":id")
  @ApiOkResponse({ type: EventResponse })
  get(@OrganizerId() tenant: string, @Param("id", uuid) id: string) {
    return this.organizer.getEvent(tenant, id);
  }

  @Post()
  @ApiOrganizerWrite(201, EventResponse)
  create(
    @OrganizerId() tenant: string,
    @Body() dto: CreateEventDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.createEvent(tenant, dto, key);
  }

  @Patch(":id")
  @ApiOrganizerWrite(200, EventResponse)
  update(
    @OrganizerId() tenant: string,
    @Param("id", uuid) id: string,
    @Body() dto: UpdateEventDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.updateEvent(tenant, id, dto, key);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOrganizerWrite(204)
  remove(
    @OrganizerId() tenant: string,
    @Param("id", uuid) id: string,
    @Query() query: DeleteQuery,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.deleteEvent(tenant, id, query.version, key);
  }
}

@ApiTags("organizer-ticket-classes")
@ApiBearerAuth()
@ApiOrganizerErrors()
@Roles("ORGANIZER")
@Controller("organizer/events/:eventId/ticket-classes")
export class OrganizerTicketClassesController {
  constructor(private readonly organizer: OrganizerService) {}

  @Get()
  @ApiOkResponse({ type: TicketClassPage })
  list(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Query() query: PageQuery,
  ) {
    return this.organizer.listTicketClasses(tenant, eventId, query);
  }

  @Get(":id")
  @ApiOkResponse({ type: TicketClassResponse })
  get(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Param("id", uuid) id: string,
  ) {
    return this.organizer.getTicketClass(tenant, eventId, id);
  }

  @Post()
  @ApiOrganizerWrite(201, TicketClassResponse)
  create(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Body() dto: CreateTicketClassDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.createTicketClass(tenant, eventId, dto, key);
  }

  @Patch(":id")
  @ApiOrganizerWrite(200, TicketClassResponse)
  update(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Param("id", uuid) id: string,
    @Body() dto: UpdateTicketClassDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.updateTicketClass(tenant, eventId, id, dto, key);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOrganizerWrite(204)
  remove(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Param("id", uuid) id: string,
    @Query() query: DeleteQuery,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.deleteTicketClass(tenant, eventId, id, query.version, key);
  }
}

@ApiTags("organizer-sale-phases")
@ApiBearerAuth()
@ApiOrganizerErrors()
@Roles("ORGANIZER")
@Controller("organizer/events/:eventId/sale-phases")
export class OrganizerSalePhasesController {
  constructor(private readonly organizer: OrganizerService) {}

  @Get()
  @ApiOkResponse({ type: SalePhasePage })
  list(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Query() query: PageQuery,
  ) {
    return this.organizer.listSalePhases(tenant, eventId, query);
  }

  @Get(":id")
  @ApiOkResponse({ type: SalePhaseResponse })
  get(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Param("id", uuid) id: string,
  ) {
    return this.organizer.getSalePhase(tenant, eventId, id);
  }

  @Post()
  @ApiOrganizerWrite(201, SalePhaseResponse)
  create(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Body() dto: CreateSalePhaseDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.createSalePhase(tenant, eventId, dto, key);
  }

  @Patch(":id")
  @ApiOrganizerWrite(200, SalePhaseResponse)
  update(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Param("id", uuid) id: string,
    @Body() dto: UpdateSalePhaseDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.updateSalePhase(tenant, eventId, id, dto, key);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOrganizerWrite(204)
  remove(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Param("id", uuid) id: string,
    @Query() query: DeleteQuery,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.deleteSalePhase(tenant, eventId, id, query.version, key);
  }
}
