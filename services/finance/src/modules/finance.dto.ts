import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

class SalesRow {
  @ApiProperty({ format: "uuid" }) ticket_class_id!: string;
  @ApiProperty({ minimum: 0 }) sold!: number;
  @ApiProperty({ example: "110000", pattern: "^\\d+$" }) revenue_vnd!: string;
}
class RevenueRow {
  @ApiProperty({ enum: ["TICKET", "MERCH"] }) category!: string;
  @ApiProperty({ example: "110000" }) gross_vnd!: string;
  @ApiProperty({ example: "100000" }) net_vnd!: string;
  @ApiProperty({ example: "10000" }) vat_vnd!: string;
}
export class StatsResponse {
  @ApiProperty({ format: "uuid" }) event_id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: [SalesRow] }) sales!: SalesRow[];
  @ApiProperty({ type: [RevenueRow] }) revenue!: RevenueRow[];
}
class AuditRow {
  @ApiProperty({ example: "1", description: "bigint dưới dạng chuỗi" }) id!: string;
  @ApiProperty({ format: "uuid" }) message_id!: string;
  @ApiProperty({ type: String, nullable: true, format: "uuid" }) actor_id!: string | null;
  @ApiProperty() action!: string;
  @ApiProperty() resource_type!: string;
  @ApiProperty() resource_id!: string;
  @ApiProperty({ type: Object, nullable: true, additionalProperties: true }) before_state!: unknown;
  @ApiProperty({ type: Object, nullable: true, additionalProperties: true }) after_state!: unknown;
  @ApiProperty({ minLength: 64, maxLength: 64 }) prev_hash!: string;
  @ApiProperty({ minLength: 64, maxLength: 64 }) hash!: string;
  @ApiProperty({ format: "date-time" }) created_at!: string;
}
export class AuditPage {
  @ApiProperty({ type: [AuditRow] }) items!: AuditRow[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
class DeadLetterRow {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() topic!: string;
  @ApiProperty() partition!: number;
  @ApiProperty() offset!: string;
  @ApiProperty() original_topic!: string;
  @ApiProperty({ type: String, nullable: true }) message_id!: string | null;
  @ApiProperty({ type: String, nullable: true, description: "base64 bytes key Kafka" })
  message_key!: string | null;
  @ApiProperty({ type: String, nullable: true, description: "base64 bytes payload Kafka" })
  payload!: string | null;
  @ApiProperty({
    type: Object,
    additionalProperties: { type: "array", items: { type: "string" } },
    description: "Giá trị header là mảng base64",
  })
  headers!: Record<string, string[]>;
  @ApiProperty() error!: string;
  @ApiProperty({ enum: ["PENDING", "REPLAY_PENDING", "REPLAYED", "DISCARDED"] }) status!: string;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty({ format: "date-time" }) updated_at!: string;
  @ApiProperty() version!: number;
}
export class DlqPage {
  @ApiProperty({ type: [DeadLetterRow] }) items!: DeadLetterRow[];
  @ApiProperty({ type: String, nullable: true, format: "uuid" }) next_cursor!: string | null;
}
export class DlqActionResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ enum: ["REPLAY_PENDING", "REPLAYED", "DISCARDED"] }) status!: string;
}
export class AuditVerifyResponse {
  @ApiProperty() ok!: boolean;
  @ApiProperty({ minimum: 0 }) checked!: number;
  @ApiPropertyOptional({ description: "id bigint của dòng lỗi đầu tiên" }) first_broken_id?: string;
}
