import { Module } from "@nestjs/common";
import { OrganizerModule } from "../organizer/organizer.module";
import { CatalogCache } from "./catalog-cache";
import { PublicCatalogController } from "./public-catalog.controller";
import { PublicCatalogRepository } from "./public-catalog.repository";
import { PublicCatalogService } from "./public-catalog.service";

@Module({
  imports: [OrganizerModule],
  controllers: [PublicCatalogController],
  providers: [CatalogCache, PublicCatalogRepository, PublicCatalogService],
})
export class PublicCatalogModule {}
