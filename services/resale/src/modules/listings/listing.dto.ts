import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class QuoteRequest {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  ticket_id!: string;

  @ApiProperty({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  ask_price_vnd!: number;
}

export class ListingQuery {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}

export class QuoteResponse {
  @ApiProperty({ format: "uuid" }) ticket_id!: string;
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty({ example: "100000" }) original_price_vnd!: string;
  @ApiProperty({ example: "120000" }) ask_price_vnd!: string;
  @ApiProperty({ example: "120000" }) maximum_price_vnd!: string;
  @ApiProperty({ example: 120 }) max_percent!: number;
}

export class ListingView {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) ticket_id!: string;
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty() original_price_vnd!: string;
  @ApiProperty() ask_price_vnd!: string;
  @ApiProperty() max_percent!: number;
  @ApiProperty({ enum: ["ACTIVE", "SOLD", "CANCELLED", "EXPIRED"] }) status!: string;
  @ApiProperty() version!: number;
}

export class ListingPage {
  @ApiProperty({ type: [ListingView] }) items!: ListingView[];
  @ApiProperty({ type: String, format: "uuid", nullable: true }) next_cursor!: string | null;
}
