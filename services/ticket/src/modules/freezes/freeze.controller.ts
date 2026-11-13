import {
  Body,
  Controller,
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
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Public } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { timingSafeEqual } from "node:crypto";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { FreezeInput, FreezeView } from "./freeze.dto";
import { FreezeService } from "./freeze.service";

@ApiTags("internal-ticket-freezes")
@ApiHeader({ name: "X-Internal-Key", required: true })
@ApiHeader({
  name: "Idempotency-Key",
  required: true,
  schema: { type: "string", format: "uuid" },
  description: "Must equal listing_id",
})
@ApiUnauthorizedResponse({ description: "Internal service key required" })
@ApiBadRequestResponse({ description: "Invalid IDs or request key" })
@ApiNotFoundResponse({ description: "Ticket absent or seller mismatch" })
@ApiConflictResponse({ description: "Ticket unavailable or freeze reference closed/reused" })
@ApiParam({ name: "ticketId", format: "uuid" })
@Public()
@Controller("internal/tickets/:ticketId")
export class FreezeController {
  constructor(
    private readonly freezes: FreezeService,
    @Inject(ENV) private readonly env: Env,
  ) {}
  private authorize(value: string): void {
    const expected = Buffer.from(this.env.INTERNAL_API_KEY ?? "");
    const supplied = Buffer.from(value ?? "");
    if (
      expected.length === 0 ||
      supplied.length !== expected.length ||
      !timingSafeEqual(expected, supplied)
    )
      throw new ProblemException("UNAUTHORIZED", 401, "Internal service key required");
  }

  @Post("freeze")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Freeze an owned ACTIVE ticket for one resale listing" })
  @ApiOkResponse({ type: FreezeView })
  freeze(
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("x-internal-key") internalKey: string,
    @Headers("idempotency-key") key: string,
    @Body() input: FreezeInput,
  ) {
    this.authorize(internalKey);
    return this.freezes.handle(ticketId, key, input, false);
  }

  @Post("unfreeze")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({
    summary: "Release the matching listing freeze and close its reference idempotently",
  })
  @ApiOkResponse({ type: FreezeView })
  unfreeze(
    @Param("ticketId", ParseUUIDPipe) ticketId: string,
    @Headers("x-internal-key") internalKey: string,
    @Headers("idempotency-key") key: string,
    @Body() input: FreezeInput,
  ) {
    this.authorize(internalKey);
    return this.freezes.handle(ticketId, key, input, true);
  }
}
