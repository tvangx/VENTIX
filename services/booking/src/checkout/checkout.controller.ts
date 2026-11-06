import { Body, Controller, Headers, Post, Res } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser } from "@ticketing/auth-guard";
import { ProblemException, requestContext } from "@ticketing/common";
import { randomUUID } from "node:crypto";
import { Response } from "express";
import { CheckoutDto, CheckoutResponseDto } from "./checkout.dto";
import { CheckoutService } from "./checkout.service";

@ApiTags("checkout")
@ApiBearerAuth()
@Controller("checkout")
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}
  @Post()
  @ApiOperation({ summary: "Convert held seats and GA/merch items into an order at server prices" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiCreatedResponse({ type: CheckoutResponseDto })
  @ApiResponse({ status: 400, description: "Invalid input or missing Idempotency-Key" })
  @ApiResponse({ status: 401, description: "JWT required" })
  @ApiResponse({ status: 403, description: "ADMISSION_REQUIRED" })
  @ApiResponse({
    status: 409,
    description: "EVENT_NOT_ON_SALE, HOLD_NOT_FOUND, SEAT_UNAVAILABLE, TICKET_UNAVAILABLE",
  })
  @ApiResponse({
    status: 422,
    description: "VOUCHER_NOT_SUPPORTED, IDEMPOTENCY_KEY_REUSED, INVALID_TICKET_CLASS",
  })
  @ApiResponse({
    status: 503,
    description: "EVENT_NOT_READY, MERCH_UNAVAILABLE, SEAT_HOLD_UNAVAILABLE",
    headers: { "Retry-After": { schema: { type: "integer", example: 1 } } },
  })
  async checkout(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Body() input: CheckoutDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CheckoutResponseDto> {
    try {
      return await this.checkoutService.checkout(
        user.userId.toLowerCase(),
        key,
        input,
        requestContext.get()?.traceId ?? requestContext.get()?.requestId ?? randomUUID(),
      );
    } catch (error) {
      if (error instanceof ProblemException && error.getStatus() === 503)
        response.setHeader("Retry-After", "1");
      throw error;
    }
  }
}
