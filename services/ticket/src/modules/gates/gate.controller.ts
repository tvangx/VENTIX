import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser, Roles } from "@ticketing/auth-guard";
import {
  AssignStaff,
  AssignTickets,
  AssignmentView,
  CreateGate,
  CreateVerificationPackage,
  GatePage,
  GateQuery,
  GateView,
  TicketAssignmentView,
  VerificationPackage,
} from "./gate.dto";
import { GateService } from "./gate.service";

@ApiTags("gates")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "JWT required" })
@ApiForbiddenResponse({ description: "Role, tenant or gate assignment denied" })
@ApiBadRequestResponse({ description: "Invalid input or missing UUID Idempotency-Key" })
@ApiConflictResponse({
  description: "Event unavailable, assignment conflict, expired package or request key reused",
})
@ApiNotFoundResponse({ description: "Gate unavailable" })
@Controller("gates")
export class GateController {
  constructor(private readonly gates: GateService) {}

  @Post()
  @Roles("ADMIN", "ORGANIZER")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Create a gate for an event in the authenticated organizer tenant" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiCreatedResponse({ type: GateView })
  create(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Body() input: CreateGate,
  ) {
    return this.gates.create(user, key, input);
  }

  @Get("me")
  @Roles("STAFF")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "List gates currently assigned to this staff member" })
  @ApiOkResponse({ type: GatePage })
  list(@CurrentUser() user: AuthUser, @Query() query: GateQuery) {
    return this.gates.list(user, query);
  }

  @Post(":gateId/staff")
  @Roles("ADMIN", "ORGANIZER")
  @Header("Cache-Control", "private, no-store")
  @ApiParam({ name: "gateId", format: "uuid" })
  @ApiOperation({ summary: "Assign staff to a gate" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiCreatedResponse({ type: AssignmentView })
  assign(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Param("gateId", ParseUUIDPipe) gateId: string,
    @Body() input: AssignStaff,
  ) {
    return this.gates.assign(user, key, gateId, input.staff_user_id, false);
  }

  @Post(":gateId/staff/revoke")
  @Roles("ADMIN", "ORGANIZER")
  @Header("Cache-Control", "private, no-store")
  @ApiParam({ name: "gateId", format: "uuid" })
  @ApiOperation({ summary: "Revoke a staff gate assignment" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiCreatedResponse({ type: AssignmentView })
  revoke(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Param("gateId", ParseUUIDPipe) gateId: string,
    @Body() input: AssignStaff,
  ) {
    return this.gates.assign(user, key, gateId, input.staff_user_id, true);
  }

  @Post(":gateId/tickets")
  @Roles("ADMIN", "ORGANIZER")
  @Header("Cache-Control", "private, no-store")
  @ApiParam({ name: "gateId", format: "uuid" })
  @ApiOperation({ summary: "Assign previously unassigned event tickets to this gate" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiCreatedResponse({ type: TicketAssignmentView })
  tickets(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Param("gateId", ParseUUIDPipe) gateId: string,
    @Body() input: AssignTickets,
  ) {
    return this.gates.assignTickets(user, key, gateId, input.ticket_ids);
  }

  @Post(":gateId/verification-packages")
  @Roles("STAFF")
  @Header("Cache-Control", "private, no-store")
  @ApiParam({ name: "gateId", format: "uuid" })
  @ApiOperation({ summary: "Download a TTL-bound encrypted ticket package for an assigned gate" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiCreatedResponse({ type: VerificationPackage })
  @ApiServiceUnavailableResponse({ description: "An active ticket secret could not be read" })
  verificationPackage(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Param("gateId", ParseUUIDPipe) gateId: string,
    @Body() input: CreateVerificationPackage,
  ) {
    return this.gates.verificationPackage(user, key, gateId, input.public_key_pem);
  }
}
