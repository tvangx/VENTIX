import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
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
  OfflineBatchInput,
  OfflineDeviceView,
  OfflineSyncResponse,
  RegisterOfflineDevice,
  RevocationPage,
  RevocationQuery,
} from "./offline.dto";
import { OfflineService } from "./offline.service";

@ApiTags("offline-check-in")
@ApiBearerAuth()
@Roles("STAFF")
@ApiUnauthorizedResponse({ description: "JWT required" })
@ApiForbiddenResponse({ description: "Staff tenant/assignment or HMAC signature denied" })
@ApiBadRequestResponse({ description: "Invalid input, request key or scan timestamp" })
@ApiNotFoundResponse({ description: "Gate, package or owned device unavailable" })
@ApiConflictResponse({ description: "Context mismatch, expired package or reused request/scan ID" })
@ApiServiceUnavailableResponse({ description: "Signing or ticket key unavailable" })
@Controller()
export class OfflineController {
  constructor(private readonly offline: OfflineService) {}

  @Post("offline-devices")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({
    summary: "Register a HMAC device session for an owned, current gate verification package",
  })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiCreatedResponse({ type: OfflineDeviceView })
  register(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Body() input: RegisterOfflineDevice,
  ) {
    return this.offline.register(user, key, input);
  }

  @Post("offline-sync")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({
    summary:
      "Verify a signed offline batch, record scans idempotently and return current revocations",
  })
  @ApiHeader({
    name: "Idempotency-Key",
    description: "Must equal batch_id",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiOkResponse({ type: OfflineSyncResponse })
  sync(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Body() input: OfflineBatchInput,
  ) {
    return this.offline.sync(user, key, input);
  }

  @Get("offline-devices/:deviceId/revocations")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({
    summary:
      "Page through current ticket revocations and secret-version changes for an owned device gate",
  })
  @ApiParam({ name: "deviceId", format: "uuid" })
  @ApiOkResponse({ type: RevocationPage })
  revocations(
    @CurrentUser() user: AuthUser,
    @Param("deviceId", ParseUUIDPipe) deviceId: string,
    @Query() query: RevocationQuery,
  ) {
    return this.offline.revocations(user, deviceId, query);
  }
}
