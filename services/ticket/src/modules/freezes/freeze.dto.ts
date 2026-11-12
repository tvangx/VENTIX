import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsUUID } from "class-validator";
import { normalizeUuid } from "../checkin/checkin.dto";

export class FreezeInput {
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() listing_id!: string;
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() seller_id!: string;
}

export class FreezeView {
  @ApiProperty({ format: "uuid" }) listing_id!: string;
  @ApiProperty({ format: "uuid" }) ticket_id!: string;
  @ApiProperty({ format: "uuid" }) seller_id!: string;
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty({ type: String, nullable: true, format: "uuid" }) organizer_id!: string | null;
  @ApiProperty() original_price_vnd!: string;
  @ApiProperty({ enum: ["FROZEN", "RELEASED"] }) freeze_status!: "FROZEN" | "RELEASED";
  @ApiProperty() ticket_status!: string;
}
