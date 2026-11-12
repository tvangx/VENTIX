import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional, IntersectionType, PartialType } from "@nestjs/swagger";

export const MAX_DB_INT = 2147483647;
const TIME_ZONE = /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function queryInteger(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
}

export class PageQuery {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class VersionDto {
  @ApiProperty({ minimum: 0, maximum: MAX_DB_INT })
  @IsInt()
  @Min(0)
  @Max(MAX_DB_INT)
  version!: number;
}

export class DeleteQuery extends VersionDto {
  @Transform(({ value }) => queryInteger(value))
  declare version: number;
}

export class CreateVenueDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ maxLength: 512 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(512)
  address!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_DB_INT })
  @IsInt()
  @Min(1)
  @Max(MAX_DB_INT)
  capacity!: number;
}

export class UpdateVenueDto extends IntersectionType(
  PartialType(CreateVenueDto, { skipNullProperties: false }),
  VersionDto,
) {}

export class CreateEventDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  venue_id!: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(255)
  title!: string;

  @ApiProperty({ maxLength: 10000 })
  @IsString()
  @MaxLength(10000)
  description!: string;

  @ApiPropertyOptional({ type: String, maxLength: 512, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(512)
  banner_key?: string | null;

  @ApiProperty({ format: "date-time" })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TIME_ZONE)
  start_at!: string;

  @ApiProperty({ format: "date-time" })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TIME_ZONE)
  end_at!: string;
}

export class UpdateEventDto extends IntersectionType(
  PartialType(CreateEventDto, { skipNullProperties: false }),
  VersionDto,
) {}

export class CreateTicketClassDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(128)
  name!: string;

  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  price_vnd!: number;

  @ApiProperty({ minimum: 1, maximum: MAX_DB_INT })
  @IsInt()
  @Min(1)
  @Max(MAX_DB_INT)
  capacity!: number;

  @ApiProperty({ enum: ["SEATED", "GA"] })
  @IsIn(["SEATED", "GA"])
  kind!: "SEATED" | "GA";
}

export class UpdateTicketClassDto extends IntersectionType(
  PartialType(CreateTicketClassDto, { skipNullProperties: false }),
  VersionDto,
) {}

export class CreateSalePhaseDto {
  @ApiProperty({ format: "date-time" })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TIME_ZONE)
  starts_at!: string;

  @ApiProperty({ format: "date-time" })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TIME_ZONE)
  ends_at!: string;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  queue_enabled?: boolean;

  @ApiProperty({ minimum: 1, maximum: MAX_DB_INT })
  @IsInt()
  @Min(1)
  @Max(MAX_DB_INT)
  admit_rate!: number;

  @ApiProperty({ minimum: 1, maximum: MAX_DB_INT })
  @IsInt()
  @Min(1)
  @Max(MAX_DB_INT)
  per_user_limit!: number;

  @ApiPropertyOptional({ default: false })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  require_kyc?: boolean;
}

export class UpdateSalePhaseDto extends IntersectionType(
  PartialType(CreateSalePhaseDto, { skipNullProperties: false }),
  VersionDto,
) {}

class SeatMapRowDto {
  @ApiProperty({ maxLength: 16 }) label!: string;
  @ApiProperty({ minimum: 1, maximum: 1000 }) seats!: number;
  @ApiProperty({ format: "uuid" }) ticket_class_id!: string;
}

class SeatMapBlockDto {
  @ApiProperty({ maxLength: 128 }) name!: string;
  @ApiProperty({ type: [SeatMapRowDto] }) rows!: SeatMapRowDto[];
}

class SeatMapZoneDto {
  @ApiProperty({ maxLength: 128 }) name!: string;
  @ApiProperty({ type: [SeatMapBlockDto] }) blocks!: SeatMapBlockDto[];
}

class SeatMapLayoutDto {
  @ApiProperty({ type: [SeatMapZoneDto] }) zones!: SeatMapZoneDto[];
}

export class CreateSeatMapDto {
  @ApiProperty({ type: SeatMapLayoutDto })
  @IsObject()
  layout!: SeatMapLayoutDto;
}
