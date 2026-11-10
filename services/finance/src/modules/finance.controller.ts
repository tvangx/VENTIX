import { Controller, Get, Post, Param, Query, ParseUUIDPipe } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiTags,
  ApiQuery,
  ApiResponse,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser, Roles } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { StatsService } from "./stats/stats.service";
import { AuditService } from "./audit/audit.service";
import { DlqService } from "./dlq/dlq.service";
import {
  StatsResponse,
  AuditPage,
  DlqPage,
  DlqActionResponse,
  AuditVerifyResponse,
} from "./finance.dto";

function page(cursor?: string, limit = "50") {
  if (
    cursor !== undefined &&
    (typeof cursor !== "string" ||
      !/^[1-9]\d{0,18}$/.test(cursor) ||
      BigInt(cursor) > 9223372036854775807n)
  )
    throw new ProblemException("INVALID_CURSOR", 400, "Cursor không hợp lệ");
  if (typeof limit !== "string" || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 200)
    throw new ProblemException("INVALID_LIMIT", 400, "Limit phải từ 1 đến 200");
  return { cursor, limit: Number(limit) };
}

@ApiTags("finance")
@ApiBearerAuth()
@ApiResponse({ status: 401, description: "JWT thiếu hoặc không hợp lệ (problem+json)" })
@ApiResponse({ status: 403, description: "Sai role hoặc tenant (problem+json)" })
@Controller()
export class FinanceController {
  constructor(
    private readonly stats: StatsService,
    private readonly audit: AuditService,
    private readonly dlq: DlqService,
  ) {}
  @Get("organizer/events/:id/stats")
  @Roles("ORGANIZER", "ADMIN")
  @ApiOperation({ summary: "Thống kê event; tiền VND là chuỗi số nguyên để không mất chính xác" })
  @ApiOkResponse({ type: StatsResponse })
  @ApiResponse({ status: 404, description: "EVENT_NOT_FOUND" })
  statsForEvent(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.stats.get(id, user);
  }

  @Get("admin/audit/verify")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Kiểm tra toàn bộ hash-chain audit" })
  @ApiOkResponse({ type: AuditVerifyResponse })
  verify() {
    return this.audit.verify();
  }

  @Get("admin/audit")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Audit theo cursor id tăng dần" })
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "action", required: false })
  @ApiQuery({ name: "resource_type", required: false })
  @ApiOkResponse({ type: AuditPage })
  auditList(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("action") action?: string,
    @Query("resource_type") resourceType?: string,
  ) {
    const p = page(cursor, limit);
    return this.audit.list(p.cursor, p.limit, action, resourceType);
  }

  @Get("admin/dlq")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Dead letters theo cursor UUID tăng dần" })
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({ type: DlqPage })
  dlqList(@Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    if (
      cursor !== undefined &&
      (typeof cursor !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor))
    )
      throw new ProblemException("INVALID_CURSOR", 400, "Cursor không hợp lệ");
    return this.dlq.list(cursor, page(undefined, limit).limit);
  }

  @Post("admin/dlq/:id/replay")
  @Roles("ADMIN")
  @ApiOperation({
    summary: "Xếp replay qua Outbox, giữ nguyên payload/message_id; idempotent theo dead letter",
  })
  @ApiResponse({ status: 201, type: DlqActionResponse })
  @ApiResponse({
    status: 409,
    description: "Không replay dead letter đã discard hoặc payload sai schema",
  })
  replay(@Param("id", ParseUUIDPipe) id: string) {
    return this.dlq.replay(id);
  }

  @Post("admin/dlq/:id/discard")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Discard dead letter; idempotent theo dead letter" })
  @ApiResponse({ status: 201, type: DlqActionResponse })
  @ApiResponse({ status: 409, description: "Dead letter đã hoặc đang replay" })
  discard(@Param("id", ParseUUIDPipe) id: string) {
    return this.dlq.discard(id);
  }
}
