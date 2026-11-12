import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles, type AuthUser } from "@ticketing/auth-guard";
import { CancelEventDto, DecideEventDto, EventReviewResponse } from "./event-lifecycle.dto";
import { EventLifecycleService } from "./event-lifecycle.service";
import { ApiOrganizerErrors, ApiOrganizerWrite, OrganizerId } from "./organizer-http";
import { PageQuery, VersionDto } from "./organizer.dto";
import { EventPage, EventResponse } from "./organizer.responses";

@ApiTags("organizer-event-lifecycle")
@ApiBearerAuth()
@ApiOrganizerErrors()
@Roles("ORGANIZER")
@Controller("organizer/events/:id")
export class OrganizerLifecycleController {
  constructor(private readonly lifecycle: EventLifecycleService) {}

  @Post("submit")
  @HttpCode(200)
  @ApiOrganizerWrite(200, EventResponse)
  submit(
    @OrganizerId() tenant: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: VersionDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.lifecycle.submit(tenant, id, dto, key);
  }

  @Post("publish")
  @HttpCode(200)
  @ApiOrganizerWrite(200, EventResponse)
  publish(
    @OrganizerId() tenant: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: VersionDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.lifecycle.publish(tenant, id, dto, key);
  }

  @Post("cancel")
  @HttpCode(200)
  @ApiOrganizerWrite(200, EventResponse)
  cancel(
    @OrganizerId() tenant: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CancelEventDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.lifecycle.cancel(tenant, id, dto, key);
  }
}

@ApiTags("admin-event-review")
@ApiBearerAuth()
@ApiOrganizerErrors()
@Roles("ADMIN")
@Controller("admin/events")
export class AdminEventReviewController {
  constructor(private readonly lifecycle: EventLifecycleService) {}

  @Get()
  @ApiOkResponse({ type: EventPage })
  list(@Query() query: PageQuery) {
    return this.lifecycle.pending(query);
  }

  @Get(":id")
  @ApiOkResponse({ type: EventReviewResponse })
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.lifecycle.review(id);
  }

  @Post(":id/decision")
  @HttpCode(200)
  @ApiOrganizerWrite(200, EventResponse)
  decide(
    @CurrentUser() user: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DecideEventDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.lifecycle.decide(id, user.userId, dto, key);
  }
}
