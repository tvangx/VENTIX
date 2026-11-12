import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { Public } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { Transform } from "class-transformer";
import { IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";
import { PrismaService } from "../../db/prisma.service";
import { MAX_DB_INT, queryInteger } from "../organizer/organizer.dto";
import { page } from "../organizer/organizer.responses";
import { InternalKeyGuard } from "./internal-key.guard";

class SeatClassesQuery {
  @Transform(({ value }) => queryInteger(value))
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_DB_INT)
  seat_map_version?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @Transform(({ value }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(5000)
  limit = 1000;
}

@ApiExcludeController()
@Public()
@UseGuards(InternalKeyGuard)
@Controller("internal/events")
export class SeatClassesController {
  constructor(private readonly db: PrismaService) {}

  @Get(":eventId/seat-classes")
  async list(@Param("eventId", ParseUUIDPipe) eventId: string, @Query() query: SeatClassesQuery) {
    const map = await this.db.seatMap.findFirst({
      where: { eventId, publishedAt: { not: null }, version: query.seat_map_version },
      orderBy: { version: "desc" },
      select: { id: true, eventId: true, version: true },
    });
    if (!map) {
      throw new ProblemException("EVENT_NOT_FOUND", 404, "Không tìm thấy seat map đã publish");
    }

    const seats = await this.db.seat.findMany({
      where: {
        eventId,
        id: query.cursor ? { gt: query.cursor } : undefined,
        block: { zone: { seatMapId: map.id } },
      },
      orderBy: { id: "asc" },
      take: query.limit + 1,
      select: { id: true, ticketClassId: true },
    });
    const result = page(seats, query, ({ id, ticketClassId }) => ({
      seat_id: id,
      ticket_class_id: ticketClassId,
    }));
    return {
      event_id: map.eventId,
      seat_map_version: map.version,
      seats: result.items,
      next_cursor: result.next_cursor,
    };
  }
}
