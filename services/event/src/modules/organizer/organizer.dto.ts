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

class SeatMapCanvasDto {
  @ApiProperty({ minimum: 0, exclusiveMinimum: true, maximum: 10000 }) width!: number;
  @ApiProperty({ minimum: 0, exclusiveMinimum: true, maximum: 10000 }) height!: number;
}

class SeatMapPlacementDto {
  @ApiProperty({
    oneOf: [
      { type: "string", enum: ["rect", "ellipse"] },
      {
        type: "object",
        required: ["polygon"],
        properties: {
          polygon: {
            type: "array",
            minItems: 3,
            maxItems: 50,
            items: { type: "array", minItems: 2, maxItems: 2, items: { type: "number" } },
          },
        },
      },
    ],
    description: "rect/ellipse cần x, y, width, height; polygon không dùng các trường đó",
  })
  shape!: "rect" | "ellipse" | { polygon: number[][] };

  @ApiPropertyOptional({ minimum: 0, description: "Cạnh trái của khung" }) x?: number;
  @ApiPropertyOptional({ minimum: 0, description: "Cạnh trên của khung" }) y?: number;
  @ApiPropertyOptional({ minimum: 0, exclusiveMinimum: true }) width?: number;
  @ApiPropertyOptional({ minimum: 0, exclusiveMinimum: true }) height?: number;
  @ApiPropertyOptional({
    minimum: -360,
    maximum: 360,
    default: 0,
    description: "Độ, theo chiều kim đồng hồ, quanh tâm khung",
  })
  rotation?: number;
}

const POSITION_DESCRIPTION =
  "Có ở tất cả Khu (zones[].blocks[]) và khu đứng, hoặc không có ở đâu cả; cần canvas";

class SeatMapBlockDto {
  @ApiProperty({ maxLength: 128 }) name!: string;
  @ApiProperty({ type: [SeatMapRowDto] }) rows!: SeatMapRowDto[];

  @ApiPropertyOptional({ type: SeatMapPlacementDto, description: POSITION_DESCRIPTION })
  position?: SeatMapPlacementDto;
}

class SeatMapZoneDto {
  @ApiProperty({ maxLength: 128 }) name!: string;
  @ApiProperty({ type: [SeatMapBlockDto] }) blocks!: SeatMapBlockDto[];
}

class SeatMapGaAreaDto {
  @ApiProperty({ maxLength: 128 }) name!: string;
  @ApiProperty({ format: "uuid", description: "Hạng vé GA, mỗi hạng chỉ gắn một khu đứng" })
  ticket_class_id!: string;

  @ApiPropertyOptional({ type: SeatMapPlacementDto, description: POSITION_DESCRIPTION })
  position?: SeatMapPlacementDto;
}

class SeatMapLayoutDto {
  @ApiPropertyOptional({
    type: SeatMapCanvasDto,
    description: "Hệ tọa độ (gốc trên-trái, y xuống); bắt buộc khi có stage hoặc position",
  })
  canvas?: SeatMapCanvasDto;

  @ApiPropertyOptional({ type: SeatMapPlacementDto })
  stage?: SeatMapPlacementDto;

  @ApiProperty({
    type: [SeatMapZoneDto],
    maxItems: 100,
    description: "Được phép rỗng nếu có ga_areas (sự kiện toàn vé đứng)",
  })
  zones!: SeatMapZoneDto[];

  @ApiPropertyOptional({ type: [SeatMapGaAreaDto], maxItems: 100 })
  ga_areas?: SeatMapGaAreaDto[];
}

export class CreateSeatMapDto {
  @ApiProperty({ type: SeatMapLayoutDto })
  @IsObject()
  layout!: SeatMapLayoutDto;
}
