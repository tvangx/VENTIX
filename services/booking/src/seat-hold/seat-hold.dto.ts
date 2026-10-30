import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from "class-validator";

export class HoldEventDto {
  @ApiProperty({ format: "uuid" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @IsUUID()
  event_id!: string;
}

export class CreateHoldDto extends HoldEventDto {
  @ApiProperty({ type: [String], format: "uuid", minItems: 1, maxItems: 1000, uniqueItems: true })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((id: unknown) => (typeof id === "string" ? id.toLowerCase() : id))
      : value,
  )
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  seat_ids!: string[];
}

export class ReleaseHoldDto extends HoldEventDto {
  @ApiPropertyOptional({
    type: [String],
    format: "uuid",
    minItems: 1,
    maxItems: 1000,
    uniqueItems: true,
    description: "Omit to release all seats held by the current user in this event",
  })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value)
      ? value.map((id: unknown) => (typeof id === "string" ? id.toLowerCase() : id))
      : value,
  )
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  seat_ids?: string[];
}

export class HoldResponseDto {
  @ApiProperty({ format: "date-time" })
  expires_at!: string;

  @ApiProperty({ type: [String], format: "uuid" })
  seat_ids!: string[];
}

export class CurrentHoldResponseDto {
  @ApiProperty({
    type: String,
    format: "date-time",
    nullable: true,
    description: "Earliest seat expiry; null when no active hold exists",
  })
  expires_at!: string | null;

  @ApiProperty({ type: [String], format: "uuid" })
  seat_ids!: string[];
}
