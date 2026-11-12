import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser, Public } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { timingSafeEqual } from "node:crypto";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { KycChallengeRequest, KycChallengeResponse, KycStatus, KycVerifyRequest } from "./kyc.dto";
import { KycService } from "./kyc.service";

@ApiTags("kyc")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "JWT required" })
@ApiBadRequestResponse({ description: "Invalid input or OTP" })
@ApiConflictResponse({
  description: "Challenge consumed, account changed or identity already linked",
})
@ApiTooManyRequestsResponse({ description: "OTP cooldown or attempt limit" })
@ApiServiceUnavailableResponse({ description: "KYC, Redis or SMTP unavailable" })
@Controller("kyc")
export class KycController {
  constructor(private readonly kyc: KycService) {}
  @Get("me")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Get own KYC status and verified lookup hash" })
  @ApiOkResponse({ type: KycStatus })
  status(@CurrentUser() user: AuthUser) {
    return this.kyc.status(user.userId);
  }

  @Post("challenges")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Send KYC OTP to the account email" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiCreatedResponse({ type: KycChallengeResponse })
  challenge(
    @CurrentUser() user: AuthUser,
    @Body() input: KycChallengeRequest,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.kyc.challenge(user.userId, input, key);
  }

  @Post("verify")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Verify OTP and atomically store encrypted KYC and audit Outbox" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiOkResponse({ type: KycStatus })
  verify(
    @CurrentUser() user: AuthUser,
    @Body() input: KycVerifyRequest,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.kyc.verify(user.userId, input, key);
  }
}

@Public()
@ApiTags("internal-kyc")
@Controller("internal/users")
export class InternalKycController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly kyc: KycService,
  ) {}
  @Get(":userId/kyc")
  @Header("Cache-Control", "private, no-store")
  @ApiParam({ name: "userId", format: "uuid" })
  @ApiHeader({ name: "X-Internal-Key", required: true })
  @ApiOperation({ summary: "Get verified KYC hash for ticket-limit services" })
  @ApiOkResponse({ type: KycStatus })
  @ApiUnauthorizedResponse({ description: "Internal key required" })
  @ApiBadRequestResponse({ description: "Invalid user UUID" })
  @ApiServiceUnavailableResponse({ description: "KYC disabled" })
  status(@Param("userId", ParseUUIDPipe) userId: string, @Headers("x-internal-key") key?: string) {
    const expected = Buffer.from(this.env.INTERNAL_API_KEY ?? "");
    const received = Buffer.from(key ?? "");
    if (
      !expected.length ||
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    )
      throw new ProblemException("UNAUTHORIZED", 401, "Khóa nội bộ không hợp lệ");
    return this.kyc.status(userId);
  }
}
