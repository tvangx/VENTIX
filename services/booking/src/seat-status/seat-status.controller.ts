import { Controller, Get, Param, Res, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ProblemException } from "@ticketing/common";
import type { Response } from "express";
import { SeatStatusDto, SeatStatusParams } from "./seat-status.dto";
import { SeatStatusService } from "./seat-status.service";
import { AdmissionGuard } from "../queue/admission.guard";

@ApiTags("seat-status")
@ApiBearerAuth()
@ApiResponse({ status: 400, description: "Invalid event UUID (application/problem+json)" })
@ApiResponse({ status: 401, description: "Missing or invalid JWT (application/problem+json)" })
@ApiResponse({
  status: 503,
  description: "SEAT_STATUS_UNAVAILABLE; Retry-After: 1 (application/problem+json)",
})
@Controller("events/:id")
export class SeatStatusController {
  constructor(private readonly seats: SeatStatusService) {}

  private async retry<T>(res: Response, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ProblemException && error.getStatus() === 503)
        res.setHeader("Retry-After", "1");
      throw error;
    }
  }

  @Get("seat-status")
  @ApiOperation({ summary: "Read sold and active held seat IDs from Redis indexes" })
  @ApiOkResponse({ type: SeatStatusDto })
  snapshot(
    @Param() params: SeatStatusParams,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SeatStatusDto> {
    res.setHeader("Cache-Control", "no-store");
    return this.retry(res, () => this.seats.snapshot(params.id));
  }

  @Get("seat-stream")
  @UseGuards(AdmissionGuard)
  @ApiHeader({
    name: "X-Admission-Token",
    required: false,
    description: "Required for queue-enabled sale phases; HS256 token from queue status SSE",
  })
  @ApiProduces("text/event-stream")
  @ApiOperation({
    summary:
      "Initial snapshot then seat deltas batched every 500 ms; reconnect for a fresh snapshot",
    description:
      'event: snapshot has {sold,held,as_of}; event: delta has a JSON string array such as ["H:<seatId>","A:<seatId>","S:<seatId>"]. Last state per seat wins within a batch. No replay/Last-Event-ID support. Requires Authorization bearer header.',
  })
  @ApiResponse({
    status: 403,
    description: "ADMISSION_REQUIRED while waiting room is enabled (application/problem+json)",
  })
  @ApiOkResponse({ content: { "text/event-stream": { schema: { type: "string" } } } })
  stream(@Param() params: SeatStatusParams, @Res() res: Response): Promise<void> {
    return this.retry(res, () => this.seats.stream(params.id, res));
  }
}
