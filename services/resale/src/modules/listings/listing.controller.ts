import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from "@nestjs/swagger";
import { AuthUser, CurrentUser } from "@ticketing/auth-guard";
import {
  ListingPage,
  ListingQuery,
  ListingSearchQuery,
  ListingView,
  QuoteRequest,
  QuoteResponse,
} from "./listing.dto";
import { ListingOperationsService } from "./listing-operations.service";
import { ListingService } from "./listing.service";

@ApiTags("listings")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: "JWT required" })
@ApiBadRequestResponse({ description: "Invalid input" })
@Controller("listings")
export class ListingController {
  constructor(
    private readonly listings: ListingService,
    private readonly operations: ListingOperationsService,
  ) {}
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

  @Get()
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Search active listings by event and price using cursor pagination" })
  @ApiOkResponse({ type: ListingPage })
  search(@Query() query: ListingSearchQuery) {
    return this.listings.search(query);
  }

  @Post()
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Freeze an owned ticket and create one active listing" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiCreatedResponse({ type: ListingView })
  @ApiNotFoundResponse({ description: "Ticket absent or owned by another seller" })
  @ApiConflictResponse({ description: "Ticket/listing unavailable or request key reused" })
  @ApiUnprocessableEntityResponse({ description: "Asking price exceeds the current cap" })
  @ApiServiceUnavailableResponse({
    description: "Operation pending recovery; retry with the same key",
  })
  create(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Body() input: QuoteRequest,
  ) {
    return this.operations.create(user.userId, key, input);
  }

  @Post(":listingId/cancel")
  @HttpCode(200)
  @Header("Cache-Control", "private, no-store")
  @ApiOperation({ summary: "Cancel an owned listing and release its matching ticket freeze" })
  @ApiParam({ name: "listingId", format: "uuid" })
  @ApiHeader({
    name: "Idempotency-Key",
    required: true,
    schema: { type: "string", format: "uuid" },
  })
  @ApiOkResponse({ type: ListingView })
  @ApiNotFoundResponse({ description: "Owned listing absent" })
  @ApiConflictResponse({ description: "Sold listing or operation pending, request key reused" })
  @ApiServiceUnavailableResponse({
    description: "Cancellation pending recovery; retry with the same key",
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @Headers("idempotency-key") key: string,
    @Param("listingId", ParseUUIDPipe) listingId: string,
  ) {
    return this.operations.cancel(user.userId, key, listingId);
  }
}
