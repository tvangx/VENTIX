import { ApiProperty } from "@nestjs/swagger";

export class PublicNftDto {
  @ApiProperty({ enum: ["NOT_REQUESTED", "PENDING", "MINTING", "MINTED", "FAILED"] })
  status!: string;
  @ApiProperty({ type: String, nullable: true, enum: ["MOCK"] })
  provider!: string | null;
  @ApiProperty({ type: String, nullable: true })
  token_id!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: "NULL for MOCK. No on-chain transaction is fabricated.",
  })
  tx_hash!: string | null;
}

export class PublicTicketDto {
  @ApiProperty({ format: "uuid" }) ticket_id!: string;
  @ApiProperty({ enum: ["ACTIVE", "FROZEN", "CHECKED_IN", "REVOKED", "REFUNDED"] }) status!: string;
  @ApiProperty({
    description: "True only for ACTIVE; does not prove ownership or replace TOTP check-in.",
  })
  active!: boolean;
  @ApiProperty({ type: PublicNftDto }) nft!: PublicNftDto;
}
