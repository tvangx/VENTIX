import { Controller, Get } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser } from "@ticketing/auth-guard";

class WhoamiResponse {
  @ApiProperty({ format: "uuid" })
  userId!: string;

  @ApiProperty({ type: [String], example: ["USER"] })
  roles!: string[];

  @ApiProperty({ required: false })
  organizerId?: string;
}

/**
 * Endpoint MẪU để minh họa JWT + OpenAPI + lỗi chuẩn. Xóa khi bắt đầu viết module thật.
 */
@ApiTags("whoami")
@ApiBearerAuth()
@Controller("whoami")
export class WhoamiController {
  @Get()
  @ApiOperation({ summary: "Return the authenticated principal" })
  @ApiOkResponse({ type: WhoamiResponse })
  @ApiUnauthorizedResponse({ description: "Missing or invalid token (problem+json)" })
  whoami(@CurrentUser() user: AuthUser): WhoamiResponse {
    return user;
  }
}
