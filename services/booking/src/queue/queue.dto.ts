import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { HoldEventDto } from "../seat-hold/seat-hold.dto";

export class QueueEventDto extends HoldEventDto {}

export class QueueStatusDto {
  @ApiProperty({ enum: ["waiting", "admitted", "not_joined", "disabled"] })
  status!: "waiting" | "admitted" | "not_joined" | "disabled";

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Zero-based ZRANK; null outside queue",
  })
  position!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Estimate from rate; capacity may delay admission further",
  })
  estimated_wait_sec!: number | null;

  @ApiPropertyOptional({ description: "HS256 admission JWT; pass in X-Admission-Token" })
  admission_token?: string;

  @ApiPropertyOptional({ format: "date-time" })
  expires_at?: string;
}
