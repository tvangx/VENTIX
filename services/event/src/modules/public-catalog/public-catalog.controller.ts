import { Controller, Get, Headers, Param, ParseUUIDPipe, Query, Res } from "@nestjs/common";
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Public } from "@ticketing/auth-guard";
import type { Response } from "express";
import { CatalogDetail, CatalogPage, CatalogQuery } from "./public-catalog.dto";
import { matchesEtag, responseEtag, PublicCatalogService } from "./public-catalog.service";

const uuid = new ParseUUIDPipe({ version: "4" });

function conditionalResponse<T>(res: Response, body: T, ifNoneMatch?: string): T | undefined {
  const etag = responseEtag(body);
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, no-cache");
  if (matchesEtag(ifNoneMatch, etag)) {
    res.status(304);
    return undefined;
  }
  return body;
}

@ApiTags("public-events")
@Public()
@Controller("events")
export class PublicCatalogController {
  constructor(private readonly catalog: PublicCatalogService) {}

  @Get()
  @ApiOperation({ summary: "Danh sách và tìm kiếm sự kiện đã công khai" })
  @ApiHeader({ name: "If-None-Match", required: false })
  @ApiOkResponse({ type: CatalogPage })
  @ApiResponse({ status: 304, description: "ETag còn hiệu lực" })
  @ApiResponse({ status: 400, description: "Query không hợp lệ" })
  async list(
    @Query() query: CatalogQuery,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return conditionalResponse(res, await this.catalog.list(query), ifNoneMatch);
  }

  @Get(":id")
  @ApiOperation({ summary: "Chi tiết sự kiện đã công khai" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiHeader({ name: "If-None-Match", required: false })
  @ApiOkResponse({ type: CatalogDetail })
  @ApiResponse({ status: 304, description: "ETag còn hiệu lực" })
  @ApiResponse({ status: 404, description: "Không có sự kiện công khai" })
  async detail(
    @Param("id", uuid) id: string,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    return conditionalResponse(res, await this.catalog.detail(id), ifNoneMatch);
  }
}
