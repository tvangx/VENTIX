import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { CheckinResponse, normalizeUuid } from "../checkin/checkin.dto";

export class RegisterOfflineDevice {
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() gate_id!: string;
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() package_id!: string;
  @ApiProperty({ description: "Same RSA SPKI public key used to download the package" })
  @IsString()
  @MinLength(100)
  @MaxLength(1500)
  public_key_pem!: string;
}

export class OfflineDeviceView {
  @ApiProperty({
    format: "date-time",
    description: "Current server clock for timestamp correction, refreshed on replay",
  })
  server_time!: string;
  @ApiProperty({ format: "uuid" }) device_id!: string;
  @ApiProperty({ format: "uuid" }) package_id!: string;
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty({ format: "uuid" }) gate_id!: string;
  @ApiProperty({ format: "date-time" }) issued_at!: string;
  @ApiProperty({ format: "date-time" }) expires_at!: string;
  @ApiProperty({ enum: ["HMAC-SHA256"] }) algorithm!: "HMAC-SHA256";
  @ApiProperty({ description: "Base64 RSA-OAEP SHA-256 wrapped HMAC key" }) encrypted_key!: string;
  @ApiProperty({ description: "Base64 OAEP label binding the key to this device/package" })
  oaep_label!: string;
}

export class OfflineScan {
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() scan_id!: string;
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() ticket_id!: string;
  @ApiProperty({ minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  secret_version!: number;
  @ApiProperty({ pattern: "^[0-9]{6}$" }) @IsString() @Matches(/^\d{6}$/) token!: string;
  @ApiProperty({
    format: "date-time",
    description: "Canonical UTC ISO timestamp with milliseconds",
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Length(24, 24)
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  scanned_at!: string;
}

export class OfflineBatchInput {
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() batch_id!: string;
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() device_id!: string;
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() package_id!: string;
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() event_id!: string;
  @ApiProperty({ format: "uuid" }) @Transform(normalizeUuid) @IsUUID() gate_id!: string;
  @ApiProperty({ type: [OfflineScan], minItems: 1, maxItems: 500 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique((scan: OfflineScan | null) => scan?.scan_id)
  @IsDefined()
  @Type(() => OfflineScan)
  @ValidateNested({ each: true })
  scans!: OfflineScan[];
  @ApiProperty({ description: "Canonical base64 HMAC-SHA256 signature" })
  @IsString()
  @Matches(/^[A-Za-z0-9+/]{43}=$/)
  signature!: string;
}

export class OfflineScanView extends CheckinResponse {
  @ApiProperty({ format: "uuid" }) source_scan_id!: string;
}

export class OfflineBatchView {
  @ApiProperty({ format: "uuid" }) batch_id!: string;
  @ApiProperty({ format: "uuid" }) device_id!: string;
  @ApiProperty() record_count!: number;
  @ApiProperty() conflict_count!: number;
  @ApiProperty({ format: "date-time" }) received_at!: string;
  @ApiProperty({ type: [OfflineScanView] }) items!: OfflineScanView[];
}

export class TicketUpdate {
  @ApiProperty({ format: "uuid" }) ticket_id!: string;
  @ApiProperty() status!: string;
  @ApiProperty() secret_version!: number;
  @ApiProperty() revoked!: boolean;
}

export class RevocationPage {
  @ApiProperty({ type: [String] }) revoked_ticket_ids!: string[];
  @ApiProperty({ type: [TicketUpdate] }) ticket_updates!: TicketUpdate[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}

export class OfflineSyncResponse {
  @ApiProperty({ type: OfflineBatchView }) batch!: OfflineBatchView;
  @ApiProperty({ type: RevocationPage }) revocations!: RevocationPage;
}

export class RevocationQuery {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @Transform(normalizeUuid)
  @IsUUID()
  cursor?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 1000, default: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit = 1000;
}
