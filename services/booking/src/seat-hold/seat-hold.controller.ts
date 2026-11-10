import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import type { Response } from "express";
import {
  CreateHoldDto,
  CurrentHoldResponseDto,
  HoldEventDto,
  HoldResponseDto,
  ReleaseHoldDto,
} from "./seat-hold.dto";
import { SeatHoldService } from "./seat-hold.service";
import { AdmissionGuard } from "../queue/admission.guard";

@ApiTags("holds")
@ApiBearerAuth()
@ApiResponse({ status: 400, description: "Invalid input (application/problem+json)" })
@ApiResponse({ status: 401, description: "Missing or invalid JWT (application/problem+json)" })
@ApiResponse({
  status: 503,
  description:
    "EVENT_NOT_READY or SEAT_HOLD_UNAVAILABLE; Retry-After: 1 (application/problem+json)",
  headers: { "Retry-After": { schema: { type: "integer", example: 1 } } },
})
@Controller("holds")
export class SeatHoldController {
  constructor(private readonly holds: SeatHoldService) {}

  private async withRetryHeader<T>(res: Response, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ProblemException && error.getStatus() === 503)
        res.setHeader("Retry-After", "1");
      throw error;
    }
  }

  @Post()
  @UseGuards(AdmissionGuard)
  @ApiHeader({
    name: "X-Admission-Token",
    required: false,
    description: "Required for queue-enabled sale phases; HS256 token from queue status SSE",
  })
  @ApiOperation({
    summary: "Atomically hold all requested seats; repeated requests renew their TTL",
  })
  @ApiHeader({
    name: "Idempotency-Key",
    required: false,
    description:
      "Holds are idempotent by user/event/seat. Every successful repeat renews TTL, including requests with the same header; no cached response is replayed.",
  })
  @ApiCreatedResponse({ type: HoldResponseDto })
  @ApiResponse({ status: 403, description: "ADMISSION_REQUIRED (application/problem+json)" })
  @ApiResponse({ status: 404, description: "EVENT_NOT_ON_SALE (application/problem+json)" })
  @ApiResponse({
    status: 409,
    description: "SEAT_UNAVAILABLE with seat_id (application/problem+json)",
  })
  @ApiResponse({ status: 422, description: "HOLD_LIMIT_EXCEEDED (application/problem+json)" })
  hold(
    @CurrentUser() user: AuthUser,
    @Body() input: CreateHoldDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<HoldResponseDto> {
    return this.withRetryHeader(res, () => this.holds.hold(user.userId.toLowerCase(), input));
  }

  @Get()
  @ApiOperation({ summary: "Read active seats held by the current user in one event" })
  @ApiOkResponse({ type: CurrentHoldResponseDto })
  current(
    @CurrentUser() user: AuthUser,
    @Query() query: HoldEventDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CurrentHoldResponseDto> {
    return this.withRetryHeader(res, () =>
      this.holds.current(user.userId.toLowerCase(), query.event_id),
    );
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    summary: "Release specified seats, or all seats held by the current user in one event",
  })
  @ApiNoContentResponse()
  release(
    @CurrentUser() user: AuthUser,
    @Body() input: ReleaseHoldDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    return this.withRetryHeader(res, () => this.holds.release(user.userId.toLowerCase(), input));
  }
}
