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
import {
  AdminEventReviewController,
  OrganizerLifecycleController,
} from "./event-lifecycle.controller";
import { EventLifecycleRepository } from "./event-lifecycle.repository";
import { EventLifecycleService } from "./event-lifecycle.service";
import { SeatMapsController } from "./seat-maps.controller";
import { BannerController } from "../banners/banner.controller";
import { BannerService } from "../banners/banner.service";
import { BannerStorage } from "../banners/banner.storage";

@Module({
  controllers: [
    BannerController,
    OrganizerVenuesController,
    OrganizerEventsController,
    OrganizerTicketClassesController,
    OrganizerSalePhasesController,
    SeatMapsController,
    OrganizerLifecycleController,
    AdminEventReviewController,
  ],
  providers: [
    PrismaService,
    OrganizerRepository,
    OrganizerService,
    OrganizerWrites,
    EventLifecycleRepository,
    EventLifecycleService,
    BannerStorage,
    BannerService,
  ],
  exports: [PrismaService],
})
export class OrganizerModule {}
