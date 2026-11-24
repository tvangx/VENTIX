import { Body, Controller, Headers, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { Roles } from "@ticketing/auth-guard";
import { EventResponse } from "../organizer/organizer.responses";
import { ApiOrganizerErrors, ApiOrganizerWrite, OrganizerId } from "../organizer/organizer-http";
import { ConfirmBannerDto, PresignBannerDto, PresignBannerResponse } from "./banner.dto";
import { BannerService } from "./banner.service";

const uuid = new ParseUUIDPipe();

@ApiTags("organizer-event-banner")
@ApiBearerAuth()
@ApiOrganizerErrors()
@Roles("ORGANIZER")
@Controller("organizer/events/:eventId/banner")
export class BannerController {
  constructor(private readonly banners: BannerService) {}

  @Post("presign")
  @HttpCode(200)
  @ApiOperation({ summary: "Xin URL PUT có chữ ký để tải banner thẳng lên kho ảnh" })
  @ApiOkResponse({ type: PresignBannerResponse })
  presign(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Body() dto: PresignBannerDto,
  ) {
    return this.banners.presign(tenant, eventId, dto);
  }

  @Post("confirm")
  @HttpCode(200)
  @ApiOperation({ summary: "Xác nhận ảnh đã tải lên và gắn làm banner sự kiện" })
  @ApiOrganizerWrite(200, EventResponse)
  confirm(
    @OrganizerId() tenant: string,
    @Param("eventId", uuid) eventId: string,
    @Body() dto: ConfirmBannerDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.banners.confirm(tenant, eventId, dto, key);
  }
}
