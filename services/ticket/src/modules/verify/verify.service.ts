import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { z } from "zod";
import { PublicTicketDto } from "./verify.dto";
import { VerifyRepository } from "./verify.repository";

@Injectable()
export class VerifyService {
  constructor(private readonly repo: VerifyRepository) {}
  async lookup(input: unknown): Promise<PublicTicketDto> {
    const parsed = z.string().uuid().safeParse(input);
    if (!parsed.success)
      throw new ProblemException("INVALID_TICKET_ID", 400, "Ticket ID must be a UUID.");
    const row = await this.repo.find(parsed.data);
    if (!row) throw new ProblemException("TICKET_NOT_FOUND", 404, "Ticket was not found.");
    return {
      ticket_id: row.id,
      status: row.status,
      active: row.status === "ACTIVE",
      nft: {
        status: row.mint_status ?? "NOT_REQUESTED",
        provider: row.provider,
        token_id: row.token_id,
        tx_hash: row.provider === "MOCK" ? null : row.tx_hash,
      },
    };
  }
}
