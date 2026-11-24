import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  EventResponse,
  SalePhaseResponse,
  SeatMapResponse,
  TicketClassResponse,
  VenueResponse,
} from "../organizer/organizer.responses";

export const catalogSorts = ["id", "start_at", "price_asc"] as const;
export const catalogSaleStatuses = ["UPCOMING", "ON_SALE", "CLOSED"] as const;
export type CatalogSaleStatus = (typeof catalogSaleStatuses)[number];
const calendarTimestamp =
  /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function queryInteger({ value }: { value: unknown }) {
  return typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
}

export class CatalogQuery {
  @ApiPropertyOptional({
    description: "Tìm trong tiêu đề, tên và địa chỉ địa điểm",
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({ maxLength: 128, description: "Giá trị next_cursor từ trang trước" })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(queryInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({
    format: "date-time",
    description: "Mốc bắt đầu sự kiện, bao gồm, có múi giờ",
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(calendarTimestamp)
  start_from?: string;

  @ApiPropertyOptional({
    format: "date-time",
    description: "Mốc bắt đầu sự kiện, loại trừ, có múi giờ",
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(calendarTimestamp)
  start_before?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsOptional()
  @Transform(queryInteger)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  min_price_vnd?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsOptional()
  @Transform(queryInteger)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  max_price_vnd?: number;

  @ApiPropertyOptional({ enum: catalogSorts, default: "id" })
  @IsOptional()
  @IsIn(catalogSorts)
  sort?: (typeof catalogSorts)[number];

  @ApiPropertyOptional({ enum: catalogSaleStatuses, description: "Theo lịch mở bán của Event" })
  @IsOptional()
  @IsIn(catalogSaleStatuses)
  sale_status?: CatalogSaleStatus;
}

export class CatalogCard extends EventResponse {
  @ApiProperty({
    type: String,
    format: "uri",
    nullable: true,
    description: "URL ảnh banner công khai; null khi chưa có ảnh hoặc chưa cấu hình kho ảnh",
  })
  banner_url!: string | null;
  @ApiProperty({
    type: String,
    format: "uri",
    nullable: true,
    description: "URL thumbnail WebP; null khi banner chưa qua xử lý ảnh (khóa seed/cũ)",
  })
  thumbnail_url!: string | null;
  @ApiProperty() venue_name!: string;
  @ApiProperty() venue_address!: string;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 }) min_ticket_price_vnd!: number | null;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) next_sale_starts_at!:
    string | null;
  @ApiProperty({ enum: catalogSaleStatuses }) sale_status!: CatalogSaleStatus;
  @ApiProperty() sale_queue_enabled!: boolean;
}

export class CatalogPage {
  @ApiProperty({ type: [CatalogCard] }) items!: CatalogCard[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}

export class CatalogDetail extends EventResponse {
  @ApiProperty({
    type: String,
    format: "uri",
    nullable: true,
    description: "URL ảnh banner công khai; null khi chưa có ảnh hoặc chưa cấu hình kho ảnh",
  })
  banner_url!: string | null;
  @ApiProperty({
    type: String,
    format: "uri",
    nullable: true,
    description: "URL thumbnail WebP; null khi banner chưa qua xử lý ảnh (khóa seed/cũ)",
  })
  thumbnail_url!: string | null;
  @ApiProperty({ type: VenueResponse }) venue!: VenueResponse;
  @ApiProperty({ type: [TicketClassResponse] }) ticket_classes!: TicketClassResponse[];
  @ApiProperty({ type: [SalePhaseResponse] }) sale_phases!: SalePhaseResponse[];
  @ApiProperty({ type: SeatMapResponse, nullable: true }) seat_map!: SeatMapResponse | null;
}
