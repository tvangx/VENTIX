import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class OrganizerApplicationDto {
  @ApiProperty({ maxLength: 255 }) @IsString() @MinLength(1) @MaxLength(255) company_name!: string;
  @ApiPropertyOptional({ maxLength: 32 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  tax_code?: string;
}
export class DocumentUploadDto {
  @ApiProperty({ enum: ["BUSINESS_LICENSE"] }) @IsIn(["BUSINESS_LICENSE"]) doc_type!: string;
}
export class OrganizerDecisionDto {
  @ApiProperty({ enum: ["APPROVED", "REJECTED"] }) @IsIn(["APPROVED", "REJECTED"]) decision!:
    "APPROVED" | "REJECTED";
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}
export class OrganizerListDto {
  @ApiPropertyOptional({ enum: ["PENDING", "APPROVED", "REJECTED"] })
  @IsOptional()
  @IsIn(["PENDING", "APPROVED", "REJECTED"])
  status?: string;
  @ApiPropertyOptional({ format: "uuid" }) @IsOptional() @IsUUID() cursor?: string;
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
