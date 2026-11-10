import { Module } from "@nestjs/common";
import { PrismaService } from "../../db/prisma.service";
import {
  OrganizerVenuesController,
  OrganizerEventsController,
  OrganizerTicketClassesController,
  OrganizerSalePhasesController,
} from "./organizer.controller";
import { OrganizerRepository } from "./organizer.repository";
import { OrganizerService } from "./organizer.service";
import { OrganizerWrites } from "./organizer-writes";

@Module({
  controllers: [
    OrganizerVenuesController,
    OrganizerEventsController,
    OrganizerTicketClassesController,
    OrganizerSalePhasesController,
  ],
  providers: [PrismaService, OrganizerRepository, OrganizerService, OrganizerWrites],
})
export class OrganizerModule {}
