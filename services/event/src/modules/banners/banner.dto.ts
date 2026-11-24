import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsString, IsUUID, Max, Min } from "class-validator";
import { VersionDto } from "../organizer/organizer.dto";
import { BANNER_CONTENT_TYPES } from "./banner-file";

export class PresignBannerDto {
  @ApiProperty({ enum: BANNER_CONTENT_TYPES })
  @IsString()
  @IsIn([...BANNER_CONTENT_TYPES])
  content_type!: string;

  @ApiProperty({ minimum: 1, description: "Số byte của file; tối đa theo UPLOAD_MAX_BYTES" })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  size_bytes!: number;
}

export class ConfirmBannerDto extends VersionDto {
  @ApiProperty({ format: "uuid", description: "upload_id nhận từ bước presign" })
  @IsUUID()
  upload_id!: string;
}

export class PresignBannerResponse {
  @ApiProperty({ format: "uuid" }) upload_id!: string;
  @ApiProperty({ enum: ["PUT"] }) method!: "PUT";
  @ApiProperty() url!: string;
  @ApiProperty({
    type: "object",
    additionalProperties: { type: "string" },
    description: "Header bắt buộc gửi kèm khi PUT",
  })
  headers!: Record<string, string>;
  @ApiProperty({ format: "date-time" }) expires_at!: string;
  @ApiProperty({ minimum: 1 }) max_bytes!: number;
}

export class ConfirmBannerResponse {
  @ApiProperty({ maxLength: 512 }) banner_key!: string;
  @ApiProperty({ format: "uri", nullable: true, type: String }) banner_url!: string | null;
  @ApiProperty({ format: "uri", nullable: true, type: String }) thumbnail_url!: string | null;
  @ApiProperty({ minimum: 1, description: "Phiên bản mới của sự kiện" }) version!: number;
}
