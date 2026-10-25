import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser, Roles } from "@ticketing/auth-guard";
import type { AuthUser } from "@ticketing/auth-guard";
import type { Response } from "express";
import { LicenseFile } from "./documents.storage";
import { LicenseUploadInterceptor } from "./license-upload.interceptor";
import {
  DocumentUploadDto,
  OrganizerApplicationDto,
  OrganizerDecisionDto,
  OrganizerListDto,
} from "./organizers.dto";
import { OrganizersService } from "./organizers.service";

@ApiTags("organizer-applications")
@ApiBearerAuth()
@Controller("organizer-applications")
export class OrganizersController {
  constructor(private readonly organizers: OrganizersService) {}
  @Post()
  @ApiOperation({ summary: "Đăng ký hồ sơ Organizer, chưa cấp role" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  apply(
    @CurrentUser() user: AuthUser,
    @Body() dto: OrganizerApplicationDto,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizers.apply(user.userId, dto, key);
  }
  @Get(":organizerId")
  @ApiOperation({ summary: "Owner hoặc Admin xem hồ sơ và metadata giấy phép" })
  get(@CurrentUser() user: AuthUser, @Param("organizerId", new ParseUUIDPipe()) id: string) {
    return this.organizers.get(user.userId, id);
  }
  @Post(":organizerId/documents")
  @ApiOperation({ summary: "Owner upload giấy phép, PDF/PNG/JPEG ≤1 MiB" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["doc_type", "file"],
      properties: {
        doc_type: { type: "string", enum: ["BUSINESS_LICENSE"] },
        file: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(LicenseUploadInterceptor)
  upload(
    @CurrentUser() user: AuthUser,
    @Param("organizerId", new ParseUUIDPipe()) id: string,
    @Body() dto: DocumentUploadDto,
    @UploadedFile() file: LicenseFile | undefined,
    @Headers("idempotency-key") key?: string,
  ) {
    return this.organizers.upload(user.userId, id, dto.doc_type, file, key);
  }
  @Get(":organizerId/documents/:documentId/download")
  @ApiOperation({ summary: "Owner/Admin lấy link tải riêng, hiệu lực 60 giây" })
  download(
    @CurrentUser() user: AuthUser,
    @Param("organizerId", new ParseUUIDPipe()) id: string,
    @Param("documentId", new ParseUUIDPipe()) documentId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader("Cache-Control", "no-store");
    return this.organizers.download(user.userId, id, documentId);
  }
}

@ApiTags("admin-organizers")
@ApiBearerAuth()
@Roles("ADMIN")
@Controller("admin/organizer-applications")
export class AdminOrganizersController {
  constructor(private readonly organizers: OrganizersService) {}
  @Get()
  @ApiOperation({ summary: "Admin duyệt danh sách hồ sơ, phân trang cursor" })
  list(@CurrentUser() user: AuthUser, @Query() query: OrganizerListDto) {
    return this.organizers.list(user.userId, query);
  }
  @Patch(":organizerId")
  @ApiOperation({ summary: "Admin duyệt/từ chối PENDING, version bắt buộc" })
  decide(
    @CurrentUser() user: AuthUser,
    @Param("organizerId", new ParseUUIDPipe()) id: string,
    @Body() dto: OrganizerDecisionDto,
  ) {
    return this.organizers.decide(user.userId, id, dto);
  }
}
