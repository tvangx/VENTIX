import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID, Length } from "class-validator";
import { AuthUser, CurrentUser, Roles } from "@ticketing/auth-guard";
import { requestContext } from "@ticketing/common";
import { RefundService } from "./refund.service";
import type { SchemaObject } from "@nestjs/swagger/dist/interfaces/open-api-spec.interface";

class ReasonDto {
  @ApiProperty({ minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  reason!: string;
}
class RefundDto extends ReasonDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  order_id!: string;
}
class BatchDto extends ReasonDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  event_id!: string;
}
class RefundQuery {
  @ApiPropertyOptional({ enum: ["PENDING", "PROCESSING", "SUCCEEDED", "NEEDS_MANUAL"] })
  @IsOptional()
  @IsIn(["PENDING", "PROCESSING", "SUCCEEDED", "NEEDS_MANUAL"])
  status?: string;
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() cursor?: string;
}
const refundView: SchemaObject = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    payment_id: { type: "string", format: "uuid" },
    batch_id: { type: "string", nullable: true },
    amount_vnd: { type: "string", description: "Integer VND" },
    reason: { type: "string" },
    status: { type: "string", enum: ["PENDING", "PROCESSING", "SUCCEEDED", "NEEDS_MANUAL"] },
    attempts: { type: "integer" },
    next_attempt_at: { type: "string", nullable: true },
    last_error: { type: "string", nullable: true },
    provider_refund_id: { type: "string", nullable: true },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
};
const trace = () =>
  requestContext.get()?.traceId ?? requestContext.get()?.requestId ?? "admin-refund";
@ApiTags("admin-refunds")
@ApiBearerAuth()
@Roles("ADMIN")
@ApiResponse({ status: 400, description: "Invalid input or Idempotency-Key" })
@ApiResponse({ status: 401, description: "JWT required" })
@ApiResponse({ status: 403, description: "ADMIN role and tenant scope required" })
@ApiResponse({ status: 404, description: "Refund or batch not found" })
@ApiResponse({
  status: 409,
  description: "Payment not refundable, snapshot not ready or invalid refund state",
})
@ApiResponse({ status: 422, description: "Idempotency-Key reused for a different request" })
@Controller("admin")
export class RefundController {
  constructor(private readonly refunds: RefundService) {}
  @Post("refunds")
  @ApiOperation({ summary: "Request full refund for a succeeded ORDER payment" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: RefundDto })
  @ApiCreatedResponse({ schema: refundView })
  create(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Body() body: RefundDto,
  ) {
    return this.refunds.create(user, key, body.order_id, body.reason, trace());
  }
  @Post("refund-batches")
  @ApiOperation({ summary: "Create/replay a full-refund batch for event ORDER payments" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiBody({ type: BatchDto })
  @ApiCreatedResponse({
    schema: { type: "object", properties: { id: { type: "string", format: "uuid" } } },
  })
  batch(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Body() body: BatchDto,
  ) {
    return this.refunds.batch(user, key, body.event_id, body.reason, trace());
  }
  @Get("refund-batches/:id")
  @ApiOperation({ summary: "Read batch counts, audited in the same transaction" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        event_id: { type: "string" },
        total: { type: "integer" },
        succeeded: { type: "integer" },
        pending: { type: "integer" },
        needs_manual: { type: "integer" },
      },
    },
  })
  progress(@CurrentUser() user: AuthUser, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.refunds.batchProgress(user, id, trace());
  }
  @Get("refunds")
  @ApiOperation({ summary: "List refunds within JWT tenant scope, cursor pagination (50)" })
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["PENDING", "PROCESSING", "SUCCEEDED", "NEEDS_MANUAL"],
  })
  @ApiQuery({ name: "cursor", required: false, format: "uuid" })
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        items: { type: "array", items: refundView },
        next_cursor: { type: "string", nullable: true },
      },
    },
  })
  list(@CurrentUser() user: AuthUser, @Query() query: RefundQuery) {
    return this.refunds.list(user, query.status, query.cursor, trace());
  }
  @Post("refunds/:id/retry")
  @ApiOperation({
    summary: "Retry NEEDS_MANUAL; sent refunds reconcile only, never blindly resend",
  })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiHeader({ name: "Idempotency-Key", required: true })
  @ApiCreatedResponse({ schema: refundView })
  retry(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    return this.refunds.retry(user, key, id, trace());
  }
}
