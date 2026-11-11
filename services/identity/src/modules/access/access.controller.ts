import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CurrentUser, Roles } from "@ticketing/auth-guard";
import type { AuthUser } from "@ticketing/auth-guard";
import { AccessTokenDto } from "../auth/auth.dto";
import { AccessService } from "./access.service";
import { TenantGuard } from "./tenant.guard";
import { MeDto, TenantContextDto } from "../auth/auth.responses";

@ApiTags("identity")
@ApiBearerAuth()
@Controller("auth")
export class AccessController {
  constructor(private readonly access: AccessService) {}
  @Get("me")
  @ApiOkResponse({ type: MeDto })
  @ApiOperation({ summary: "Thông tin tài khoản và các scope được cấp" })
  me(@CurrentUser() user: AuthUser) {
    return this.access.me(user.userId);
  }

  @Post("tenants/:organizerId/token")
  @HttpCode(200)
  @ApiOperation({ summary: "Đổi sang access token cho đúng tenant" })
  @ApiOkResponse({ type: AccessTokenDto })
  token(
    @CurrentUser() user: AuthUser,
    @Param("organizerId", new ParseUUIDPipe()) organizerId: string,
  ) {
    return this.access.token(user.userId, organizerId);
  }
}

@ApiTags("identity")
@ApiBearerAuth()
@Roles("ORGANIZER", "STAFF")
@UseGuards(TenantGuard)
@Controller("organizers/:organizerId/context")
export class TenantContextController {
  constructor(private readonly access: AccessService) {}
  @Get()
  @ApiOkResponse({ type: TenantContextDto })
  @ApiOperation({ summary: "Kiểm tra quyền làm việc trong organizer hiện tại" })
  async context(
    @CurrentUser() user: AuthUser,
    @Param("organizerId", new ParseUUIDPipe()) organizerId: string,
  ) {
    return {
      organizer_id: organizerId,
      roles: await this.access.tenantRoles(user.userId, organizerId),
    };
  }
}
