import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform, Type } from "class-transformer";
import {
  IsArray,
  ArrayMaxSize,
  ArrayUnique,
  IsInt,
  Min,
  Max,
  IsUUID,
  ValidateNested,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";
import { HoldEventDto } from "../seat-hold/seat-hold.dto";

const lower = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.toLowerCase() : value;
export class GaItemDto {
  @ApiProperty({ format: "uuid" }) @Transform(lower) @IsUUID() ticket_class_id!: string;
  @ApiProperty({ minimum: 1, maximum: 1000 }) @IsInt() @Min(1) @Max(1000) quantity!: number;
}
export class MerchItemDto {
  @ApiProperty({ format: "uuid" }) @Transform(lower) @IsUUID() sku_id!: string;
  @ApiProperty({ minimum: 1, maximum: 1000 }) @IsInt() @Min(1) @Max(1000) quantity!: number;
}
export class CheckoutDto extends HoldEventDto {
  @ApiProperty({ type: [String], format: "uuid", maxItems: 1000, uniqueItems: true })
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map((id: unknown) => lower({ value: id })) : value,
  )
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  seat_ids: string[] = [];
  @ApiProperty({ type: [GaItemDto], maxItems: 1000 })
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique((i: GaItemDto) => i.ticket_class_id)
  @ValidateNested({ each: true })
  @Type(() => GaItemDto)
  ga_items: GaItemDto[] = [];
  @ApiProperty({ type: [MerchItemDto], maxItems: 1000 })
  @IsArray()
  @ArrayMaxSize(1000)
  @ArrayUnique((i: MerchItemDto) => i.sku_id)
  @ValidateNested({ each: true })
  @Type(() => MerchItemDto)
  merch_items: MerchItemDto[] = [];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) voucher_code?: string;
}
export class CheckoutResponseDto {
  @ApiProperty({ format: "uuid" }) order_id!: string;
  @ApiProperty({ enum: ["PENDING", "AWAITING_PAYMENT"] }) status!: "PENDING" | "AWAITING_PAYMENT";
  @ApiProperty() ticket_amount_vnd!: number;
  @ApiProperty() merch_amount_vnd!: number;
  @ApiProperty() total_amount_vnd!: number;
  @ApiProperty({ format: "date-time" }) expires_at!: string;
}
