import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateGate {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  event_id!: string;

  @ApiProperty({ maxLength: 100 })
  @Transform(({ value }: { value: unknown }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class AssignStaff {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  staff_user_id!: string;
}

export class AssignTickets {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 1000 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ArrayUnique()
  @IsUUID("all", { each: true })
  ticket_ids!: string[];
}

export class CreateVerificationPackage {
  @ApiProperty({
    description: "Device RSA SPKI public key in PEM, 2048–4096 bits",
    maxLength: 1500,
  })
  @IsString()
  @MinLength(100)
  @MaxLength(1500)
  public_key_pem!: string;
}

export class GateQuery {
  @ApiPropertyOptional({ format: "uuid" })
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}

export class GateView {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty() name!: string;
}

export class GatePage {
  @ApiProperty({ type: [GateView] }) items!: GateView[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}

export class AssignmentView {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) gate_id!: string;
  @ApiProperty({ format: "uuid" }) staff_user_id!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) revoked_at!: string | null;
}

export class TicketAssignmentView {
  @ApiProperty({ format: "uuid" }) gate_id!: string;
  @ApiProperty() assigned_count!: number;
}

export class VerificationPackage {
  @ApiProperty({ enum: ["ticket-verification-v1"] }) format!: "ticket-verification-v1";
  @ApiProperty({ enum: ["RSA-OAEP-256+A256GCM"] }) algorithm!: "RSA-OAEP-256+A256GCM";
  @ApiProperty({ format: "uuid" }) package_id!: string;
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty({ format: "uuid" }) gate_id!: string;
  @ApiProperty({ format: "date-time" }) issued_at!: string;
  @ApiProperty({ format: "date-time" }) expires_at!: string;
  @ApiProperty({ description: "Base64 RSA-OAEP SHA-256 encrypted AES key" }) encrypted_key!: string;
  @ApiProperty({ description: "Base64 12-byte AES-GCM nonce" }) nonce!: string;
  @ApiProperty({ description: "Base64 UTF-8 JSON metadata array authenticated by GCM" })
  aad!: string;
  @ApiProperty({ description: "Base64 AES-GCM ciphertext followed by 16-byte authentication tag" })
  ciphertext!: string;
}
