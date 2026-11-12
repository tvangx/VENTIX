import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "@ticketing/auth-guard";
import { CreateSeatMapDto, PageQuery } from "./organizer.dto";
import { ApiOrganizerErrors, ApiOrganizerWrite, OrganizerId } from "./organizer-http";
import { SeatMapPage, SeatMapResponse } from "./organizer.responses";
import { OrganizerService } from "./organizer.service";

@ApiTags("organizer-seat-maps")
@ApiBearerAuth()
@ApiOrganizerErrors()
@Roles("ORGANIZER")
@Controller("organizer/events/:eventId/seat-maps")
export class SeatMapsController {
  constructor(private readonly organizer: OrganizerService) {}

  @Get()
  @ApiOkResponse({ type: SeatMapPage })
  list(
    @OrganizerId() tenant: string,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Query() query: PageQuery,
  ) {
    return this.organizer.listSeatMaps(tenant, eventId, query);
  }

  @Get(":version")
  @ApiOkResponse({ type: SeatMapResponse })
  get(
    @OrganizerId() tenant: string,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Param("version", ParseIntPipe) version: number,
  ) {
    return this.organizer.getSeatMap(tenant, eventId, version);
  }

  @Post()
  @ApiOrganizerWrite(201, SeatMapResponse)
  create(
    @OrganizerId() tenant: string,
    @Param("eventId", ParseUUIDPipe) eventId: string,
    @Body() dto: CreateSeatMapDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizer.createSeatMap(tenant, eventId, dto, key);
  }
}
