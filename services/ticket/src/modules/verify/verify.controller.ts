import { Controller, Get, Param, Query, Res, UseGuards } from "@nestjs/common";
import { Public } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Response } from "express";
import { PublicTicketDto } from "./verify.dto";
import { VerifyGuard } from "./verify.guard";
import { verifyPage } from "./verify-page";
import { VerifyService } from "./verify.service";

@Public()
@ApiTags("public-verification")
@UseGuards(VerifyGuard)
@Controller()
export class VerifyController {
  constructor(private readonly service: VerifyService) {}

  @Get("public/tickets/:ticketId")
  @ApiOperation({ summary: "Read public ticket state without owner or secret data" })
  @ApiParam({ name: "ticketId", format: "uuid" })
  @ApiOkResponse({ type: PublicTicketDto })
  @ApiBadRequestResponse({ description: "Invalid UUID (problem+json)" })
  @ApiNotFoundResponse({ description: "Ticket not found (problem+json)" })
  @ApiTooManyRequestsResponse({ description: "Rate limited; Retry-After header (problem+json)" })
  lookup(@Param("ticketId") ticketId: string): Promise<PublicTicketDto> {
    return this.service.lookup(ticketId);
  }

  @Get("verify")
  @ApiOperation({ summary: "Public server-rendered ticket verification form" })
  @ApiProduces("text/html")
  @ApiQuery({ name: "ticket_id", required: false, type: String, format: "uuid" })
  @ApiOkResponse({
    description: "HTML form and optional lookup result",
    schema: { type: "string" },
  })
  @ApiBadRequestResponse({ description: "HTML form with invalid ticket ID error" })
  @ApiNotFoundResponse({ description: "HTML form with ticket not found error" })
  @ApiTooManyRequestsResponse({ description: "Rate limited (problem+json)" })
  async page(@Query("ticket_id") ticketId: unknown, @Res() response: Response): Promise<void> {
    try {
      response
        .type("html")
        .send(verifyPage(ticketId === undefined ? undefined : await this.service.lookup(ticketId)));
    } catch (error) {
      if (!(error instanceof ProblemException)) throw error;
      response
        .status(error.getStatus())
        .type("html")
        .send(
          verifyPage(
            undefined,
            error.code === "TICKET_NOT_FOUND"
              ? "Không tìm thấy vé. Hãy kiểm tra lại mã vé."
              : "Mã vé chưa đúng định dạng UUID.",
          ),
        );
    }
  }
}
