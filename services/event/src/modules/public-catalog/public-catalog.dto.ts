import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  EventResponse,
  SalePhaseResponse,
  SeatMapResponse,
  TicketClassResponse,
  VenueResponse,
} from "../organizer/organizer.responses";

export class CatalogQuery {
  @ApiPropertyOptional({ description: "Tìm trong tiêu đề sự kiện", maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  q?: string;

  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  )
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CatalogPage {
  @ApiProperty({ type: [EventResponse] }) items!: EventResponse[];
  @ApiProperty({ type: String, format: "uuid", nullable: true }) next_cursor!: string | null;
}

export class CatalogDetail extends EventResponse {
  @ApiProperty({ type: VenueResponse }) venue!: VenueResponse;
  @ApiProperty({ type: [TicketClassResponse] }) ticket_classes!: TicketClassResponse[];
  @ApiProperty({ type: [SalePhaseResponse] }) sale_phases!: SalePhaseResponse[];
  @ApiProperty({ type: SeatMapResponse, nullable: true }) seat_map!: SeatMapResponse | null;
}
