import { Transform } from "class-transformer";
import { IsEmail, IsString, MaxLength, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CredentialsDto {
  @ApiProperty({ example: "son@example.test", maxLength: 254 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 12, maxLength: 128, writeOnly: true })
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class AccessTokenDto {
  @ApiProperty() access_token!: string;
  @ApiProperty({ example: "Bearer" }) token_type!: string;
  @ApiProperty({ example: 900 }) expires_in!: number;
}

export class RegisteredUserDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "son@example.test" }) email!: string;
}
