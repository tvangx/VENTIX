import { ApiProperty } from "@nestjs/swagger";

export class RsaJwkDto {
  @ApiProperty({ example: "RSA" }) kty!: string;
  @ApiProperty() kid!: string;
  @ApiProperty({ example: "RS256" }) alg!: string;
  @ApiProperty({ example: "sig" }) use!: string;
  @ApiProperty() n!: string;
  @ApiProperty() e!: string;
}
export class JwksDto {
  @ApiProperty({ type: [RsaJwkDto] }) keys!: RsaJwkDto[];
}
export class GoogleStartDto {
  @ApiProperty({ format: "uri" }) authorization_url!: string;
}
export class MembershipDto {
  @ApiProperty({ format: "uuid" }) organizer_id!: string;
  @ApiProperty({ enum: ["ORGANIZER", "STAFF"] }) role!: string;
}
export class MeDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ type: [MembershipDto] }) memberships!: MembershipDto[];
}
export class TenantContextDto {
  @ApiProperty({ format: "uuid" }) organizer_id!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
}
