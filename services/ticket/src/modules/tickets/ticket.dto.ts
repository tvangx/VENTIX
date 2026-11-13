import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class TicketQuery {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class TicketView {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) order_id!: string;
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty({ format: "uuid", nullable: true, type: String }) seat_id!: string | null;
  @ApiProperty({ enum: ["TICKET_SEAT", "TICKET_GA"] }) item_type!: string;
  @ApiProperty({ format: "uuid" }) ref_id!: string;
  @ApiProperty({ example: "100000", description: "Integer VND as a decimal string" })
  unit_price_vnd!: string;
  @ApiProperty({ enum: ["ACTIVE", "FROZEN", "CHECKED_IN", "REVOKED", "REFUNDED"] }) status!: string;
  @ApiProperty() secret_version!: number;
}

export class TicketPage {
  @ApiProperty({ type: [TicketView] }) items!: TicketView[];
  @ApiProperty({ format: "uuid", nullable: true, type: String }) next_cursor!: string | null;
}

export class TicketToken {
  @ApiProperty({ format: "uuid" }) ticket_id!: string;
  @ApiProperty() secret_version!: number;
  @ApiProperty({ example: "012345" }) token!: string;
  @ApiProperty({ example: 30 }) step_seconds!: number;
  @ApiProperty({ format: "date-time" }) server_time!: string;
  @ApiProperty({ format: "date-time" }) expires_at!: string;
  @ApiProperty({ description: "JSON QR v1 containing version, ticket_id, secret_version, token" })
  qr_payload!: string;
}
