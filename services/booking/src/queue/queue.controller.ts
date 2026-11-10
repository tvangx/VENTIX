import { Body, Controller, Get, Post, Query, Res } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import type { Response } from "express";
import { QueueEventDto, QueueStatusDto } from "./queue.dto";
import { QueueService } from "./queue.service";

@ApiTags("queue")
@ApiBearerAuth()
@ApiResponse({ status: 400, description: "Invalid event UUID (application/problem+json)" })
@ApiResponse({ status: 401, description: "JWT required (application/problem+json)" })
@ApiResponse({ status: 404, description: "EVENT_NOT_ON_SALE (application/problem+json)" })
@ApiResponse({
  status: 503,
  description: "QUEUE_UNAVAILABLE (application/problem+json); Retry-After: 1",
})
@Controller("queue")
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  private async retry<T>(res: Response, run: () => Promise<T>): Promise<T> {
    res.setHeader("Cache-Control", "no-store");
    try {
      return await run();
    } catch (error) {
      if (error instanceof ProblemException && error.getStatus() === 503)
        res.setHeader("Retry-After", "1");
      throw error;
    }
  }

  @Post("join")
  @ApiOperation({
    summary: "Join Waiting Room once per authenticated user/event; repeats keep FIFO order",
  })
  @ApiHeader({
    name: "Idempotency-Key",
    required: false,
    description:
      "Idempotency is by JWT user/event via ZADD NX; header does not create another place",
  })
  @ApiCreatedResponse({ type: QueueStatusDto })
  join(
    @CurrentUser() user: AuthUser,
    @Body() input: QueueEventDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<QueueStatusDto> {
    return this.retry(res, () =>
      this.queue.status(input.event_id, user.userId.toLowerCase(), true),
    );
  }

  @Get("status")
  @ApiProduces("text/event-stream")
  @ApiOperation({
    summary: "Stream private queue position once per second, then admission token",
    description:
      "event: status with QueueStatusDto. Terminal admitted/disabled/not_joined closes stream. Reconnect replays the same unexpired grant. Requires Authorization header; tokens never appear in URL. Post-header errors use event: error with code then close.",
  })
  @ApiOkResponse({ content: { "text/event-stream": { schema: { type: "string" } } } })
  status(
    @CurrentUser() user: AuthUser,
    @Query() query: QueueEventDto,
    @Res() res: Response,
  ): Promise<void> {
    return this.retry(res, () => this.queue.stream(query.event_id, user.userId.toLowerCase(), res));
  }
}
