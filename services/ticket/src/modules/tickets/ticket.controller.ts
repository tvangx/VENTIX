import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser } from "@ticketing/auth-guard";
import { TicketPage, TicketQuery, TicketToken } from "./ticket.dto";
import { TicketService } from "./ticket.service";

@ApiTags("tickets")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "JWT required" })
@ApiBadRequestResponse({ description: "Invalid UUID or pagination parameters" })
@Controller("tickets")
export class TicketController {
  constructor(private readonly tickets: TicketService) {}

  @Get()
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "List the authenticated user's tickets" })
  @ApiOkResponse({ type: TicketPage })
  list(@CurrentUser() user: AuthUser, @Query() query: TicketQuery): Promise<TicketPage> {
    return this.tickets.list(user.userId, query);
  }

  @Get(":ticketId/token")
  @Header("Cache-Control", "private, no-store")
  @ApiParam({ name: "ticketId", format: "uuid" })
  @ApiOperation({ summary: "Get a current TOTP and QR payload for an owned active ticket" })
  @ApiOkResponse({ type: TicketToken })
  @ApiNotFoundResponse({ description: "Ticket absent or owned by another user" })
  @ApiConflictResponse({ description: "Ticket is not ACTIVE" })
  @ApiServiceUnavailableResponse({ description: "Current ticket secret unavailable" })
  token(
    @CurrentUser() user: AuthUser,
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
  ): Promise<TicketToken> {
    return this.tickets.token(user.userId, ticketId);
  }
}
