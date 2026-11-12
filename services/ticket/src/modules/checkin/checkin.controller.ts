import { Body, Controller, Header, Headers, HttpCode, Post } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser, Roles } from "@ticketing/auth-guard";
import { CheckinInput, CheckinResponse } from "./checkin.dto";
import { CheckinService } from "./checkin.service";

@ApiTags("check-in")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "JWT required" })
@ApiForbiddenResponse({
  description: "STAFF role, matching organizer and active gate assignment required",
})
@Controller("check-ins")
export class CheckinController {
  constructor(private readonly checkins: CheckinService) {}

  @Post()
  @HttpCode(200)
  @Roles("STAFF")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Verify an online ticket QR and accept a ticket once" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiOkResponse({ type: CheckinResponse })
  @ApiBadRequestResponse({ description: "Invalid QR or missing UUID request key" })
  @ApiConflictResponse({
    description: "Request key reused, gate event mismatch or cancelled event",
  })
  @ApiNotFoundResponse({ description: "Gate unavailable" })
  @ApiServiceUnavailableResponse({ description: "Current ticket secret cannot be read" })
  scan(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Body() input: CheckinInput,
  ) {
    return this.checkins.scan(user, key, input);
  }
}
