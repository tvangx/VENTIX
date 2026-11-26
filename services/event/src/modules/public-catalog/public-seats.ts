import { Controller, Get, Header, Injectable, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";
import { Public } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { Type } from "class-transformer";
import { IsInt, IsOptional, IsUUID, Min, Max } from "class-validator";
import { PrismaService } from "../../db/prisma.service";
export class PublicSeatsQuery {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) seat_map_version!: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cursor?: string;
  @ApiPropertyOptional({ default: 1000, maximum: 5000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit = 1000;
}
export class PublicSeat {
  @ApiProperty() seat_id!: string;
  @ApiProperty() ticket_class_id!: string;
  @ApiProperty() zone_name!: string;
  @ApiProperty() block_name!: string;
  @ApiProperty() row_label!: string;
  @ApiProperty() seat_no!: number;
}
export class PublicSeatsPage {
  @ApiProperty() seat_map_version!: number;
  @ApiProperty({ type: [PublicSeat] }) items!: PublicSeat[];
  @ApiProperty({ type: String, nullable: true }) next_cursor!: string | null;
}
@Injectable()
export class PublicSeatsRepository {
  constructor(private readonly db: PrismaService) {}
  async list(id: string, q: PublicSeatsQuery): Promise<PublicSeatsPage> {
    return this.db.$transaction(async (tx) => {
      const map = await tx.seatMap.findFirst({
        where: {
          eventId: id,
          version: q.seat_map_version,
          publishedAt: { not: null },
          event: { status: "PUBLISHED" },
        },
      });
      if (!map) throw new ProblemException("EVENT_NOT_FOUND", 404, "Published seat map not found");
      const seats = await tx.seat.findMany({
        where: {
          eventId: id,
          id: q.cursor ? { gt: q.cursor } : undefined,
          block: { zone: { seatMapId: map.id } },
        },
        orderBy: { id: "asc" },
        take: q.limit + 1,
        include: { block: { include: { zone: true } } },
      });
      const page = seats.slice(0, q.limit);
      return {
        seat_map_version: map.version,
        next_cursor: seats.length > q.limit ? page[page.length - 1].id : null,
        items: page.map((s) => ({
          seat_id: s.id,
          ticket_class_id: s.ticketClassId,
          zone_name: s.block.zone.name,
          block_name: s.block.name,
          row_label: s.rowLabel,
          seat_no: s.seatNo,
        })),
      };
    });
  }
}
@Public()
@ApiTags("public-events")
@Controller("events")
export class PublicSeatsController {
  constructor(private readonly seats: PublicSeatsRepository) {}
  @Get(":id/seats")
  @Header("Cache-Control", "public, no-cache")
  @ApiOkResponse({ type: PublicSeatsPage })
  @ApiOperation({
    summary: "Read paginated seat UUIDs and positions for a published seat map version",
  })
  @ApiResponse({ status: 400, description: "Invalid UUID, version or cursor/limit" })
  @ApiResponse({
    status: 404,
    description: "EVENT_NOT_FOUND; event/map not published or version absent",
  })
  list(@Param("id", ParseUUIDPipe) id: string, @Query() q: PublicSeatsQuery) {
    return this.seats.list(id, q);
  }
}
