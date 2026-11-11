import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { VersionDto } from "./organizer.dto";
import {
  EventResponse,
  SalePhaseResponse,
  SeatMapResponse,
  TicketClassResponse,
  VenueResponse,
} from "./organizer.responses";

export class DecideEventDto extends VersionDto {
  @ApiProperty({ enum: ["APPROVED", "REJECTED"] })
  @IsIn(["APPROVED", "REJECTED"])
  decision!: "APPROVED" | "REJECTED";

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  reason?: string;
}

export class CancelEventDto extends VersionDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @Matches(/\S/)
  @MaxLength(1000)
  reason!: string;
}

export class EventReviewResponse extends EventResponse {
  @ApiProperty({ type: VenueResponse }) venue!: VenueResponse;
  @ApiProperty({ type: [TicketClassResponse] }) ticket_classes!: TicketClassResponse[];
  @ApiProperty({ type: [SalePhaseResponse] }) sale_phases!: SalePhaseResponse[];
  @ApiProperty({ type: SeatMapResponse, nullable: true }) seat_map!: SeatMapResponse | null;
}
