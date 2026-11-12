import { Body, Controller, Get, Header, Headers, HttpCode, Post, Query } from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser } from "@ticketing/auth-guard";
import { ListingPage, ListingQuery, QuoteRequest, QuoteResponse } from "./listing.dto";
import { ListingService } from "./listing.service";

@ApiTags("listings")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "JWT required" })
@ApiBadRequestResponse({ description: "Invalid input" })
@Controller("listings")
export class ListingController {
  constructor(private readonly listings: ListingService) {}
  @Get("me")
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "List current seller listings" })
  @ApiOkResponse({ type: ListingPage })
  list(@CurrentUser() user: AuthUser, @Query() query: ListingQuery): Promise<ListingPage> {
    return this.listings.list(user.userId, query);
  }

  @Post("quote")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Validate a resale price using the owned ticket's server price" })
  @ApiOkResponse({ type: QuoteResponse })
  @ApiNotFoundResponse({ description: "Ticket not owned or absent" })
  @ApiConflictResponse({ description: "Ticket is not ACTIVE" })
  @ApiUnprocessableEntityResponse({ description: "Resale price exceeds cap" })
  @ApiServiceUnavailableResponse({ description: "Ticket service unavailable" })
  quote(
    @Body() input: QuoteRequest,
    @Headers("authorization") authorization: string,
  ): Promise<QuoteResponse> {
    return this.listings.quote(input, authorization);
  }
}
