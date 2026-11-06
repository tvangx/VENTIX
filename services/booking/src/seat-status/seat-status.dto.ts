import { ApiProperty } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsUUID } from "class-validator";

export class SeatStatusParams {
  @ApiProperty({ format: "uuid" })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.toLowerCase() : value,
  )
  @IsUUID()
  id!: string;
}

export class SeatStatusDto {
  @ApiProperty({ type: [String], description: "Sold seat IDs" })
  sold!: string[];
  @ApiProperty({ type: [String], description: "Active held seat IDs" })
  held!: string[];
  @ApiProperty({ format: "date-time" })
  as_of!: string;
}
