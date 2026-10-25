import { ApiProperty } from "@nestjs/swagger";

export class ApplicationResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) owner_user_id!: string;
  @ApiProperty() company_name!: string;
  @ApiProperty({ type: String, nullable: true }) tax_code!: string | null;
  @ApiProperty({ enum: ["PENDING", "APPROVED", "REJECTED"] }) status!: string;
  @ApiProperty({ minimum: 0 }) version!: number;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty({ type: String, format: "date-time", nullable: true }) approved_at!: string | null;
}
export class DocumentResponseDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["BUSINESS_LICENSE"] }) doc_type!: string;
  @ApiProperty({ format: "date-time" }) created_at!: string;
}
export class ApplicationDetailDto extends ApplicationResponseDto {
  @ApiProperty({ type: [DocumentResponseDto] }) documents!: DocumentResponseDto[];
}
export class ApplicationListDto {
  @ApiProperty({ type: [ApplicationResponseDto] }) data!: ApplicationResponseDto[];
  @ApiProperty({ type: String, format: "uuid", nullable: true }) next_cursor!: string | null;
}
export class DocumentDownloadDto {
  @ApiProperty({ format: "uri" }) url!: string;
  @ApiProperty({ example: 60 }) expires_in!: number;
}
