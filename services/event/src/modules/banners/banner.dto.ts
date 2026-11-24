import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsInt, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { VersionDto } from "../organizer/organizer.dto";
import { BANNER_CONTENT_TYPES } from "./banner-file";

export class PresignBannerDto {
  @ApiProperty({ enum: BANNER_CONTENT_TYPES })
  @IsString()
  @IsIn([...BANNER_CONTENT_TYPES])
  content_type!: string;

  @ApiProperty({ minimum: 1, description: "Số byte của file; tối đa theo BANNER_MAX_BYTES" })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  size_bytes!: number;
}

export class ConfirmBannerDto extends VersionDto {
  @ApiProperty({ maxLength: 512, description: "object_key nhận từ bước presign" })
  @IsString()
  @Matches(/\S/)
  @MaxLength(512)
  object_key!: string;
}

export class PresignBannerResponse {
  @ApiProperty({ maxLength: 512 }) object_key!: string;
  @ApiProperty({ enum: ["PUT"] }) method!: "PUT";
  @ApiProperty() upload_url!: string;
  @ApiProperty({
    type: "object",
    additionalProperties: { type: "string" },
    description: "Header bắt buộc gửi kèm khi PUT",
  })
  headers!: Record<string, string>;
  @ApiProperty({ format: "date-time" }) expires_at!: string;
  @ApiProperty({ minimum: 1 }) max_bytes!: number;
}
