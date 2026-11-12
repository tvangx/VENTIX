import { Type } from "class-transformer";
import {
  Equals,
  IsDefined,
  IsInt,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateNested,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export const CHECKIN_RESULTS = [
  "ACCEPTED",
  "DUPLICATE",
  "WRONG_EVENT",
  "WRONG_GATE",
  "INVALID",
] as const;
export type CheckinResult = (typeof CHECKIN_RESULTS)[number];

export class CheckinQr {
  @ApiProperty({ enum: [1] }) @Equals(1) version!: 1;
  @ApiProperty({ format: "uuid" }) @IsUUID() ticket_id!: string;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) secret_version!: number;
  @ApiProperty({ pattern: "^[0-9]{6}$" }) @IsString() @Matches(/^\d{6}$/) token!: string;
}

export class CheckinInput {
  @ApiProperty({ format: "uuid" }) @IsUUID() event_id!: string;
  @ApiProperty({ format: "uuid" }) @IsUUID() gate_id!: string;
  @ApiProperty({ type: CheckinQr })
  @IsDefined()
  @Type(() => CheckinQr)
  @ValidateNested()
  qr!: CheckinQr;
}

export class CheckinResponse {
  @ApiProperty({ format: "uuid" }) scan_id!: string;
  @ApiProperty({ format: "uuid" }) ticket_id!: string;
  @ApiProperty({ enum: CHECKIN_RESULTS }) result!: CheckinResult;
  @ApiProperty({ format: "date-time" }) scanned_at!: string;
}
