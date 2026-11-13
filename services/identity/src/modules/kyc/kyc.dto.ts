import { Transform } from "class-transformer";
import { IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class KycChallengeRequest {
  @ApiProperty({ pattern: "^[0-9]{12}$" })
  @Matches(/^\d{12}$/)
  id_number!: string;

  @ApiProperty({ minLength: 2, maxLength: 200 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  full_name!: string;
}

export class KycVerifyRequest {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  challenge_id!: string;

  @ApiProperty({ pattern: "^[0-9]{6}$" })
  @Matches(/^\d{6}$/)
  code!: string;
}

export class KycChallengeResponse {
  @ApiProperty({ format: "uuid" }) challenge_id!: string;
  @ApiProperty({ format: "date-time" }) expires_at!: string;
}

export class KycStatus {
  @ApiProperty() verified!: boolean;
  @ApiProperty({ type: String, nullable: true }) kycHash!: string | null;
}
