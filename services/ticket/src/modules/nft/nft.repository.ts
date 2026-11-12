import { Injectable } from "@nestjs/common";
import { TicketRepository } from "../tickets/ticket.repository";
import { MintResult } from "./minter";

export interface MintJob {
  id: string;
  ticket_id: string;
  event_id: string;
  source_message_id: string;
  trace_id: string;
  attempts: number;
  version: number;
}

@Injectable()
export class NftRepository {
  constructor(private readonly tickets: TicketRepository) {}

  async claim(options: { maxAttempts: number; leaseMs: number }): Promise<MintJob | null> {
    return this.tickets.db.transaction(async (executor) => {
      // Hết budget sau crash cũng phải đạt trạng thái cuối, không kẹt MINTING mãi.
      await executor.query(
        `WITH exhausted AS (
          SELECT id FROM nft_mints WHERE attempts >= $1
          AND (status='PENDING' OR (status='MINTING' AND lease_until <= now()))
          ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 100
        ) UPDATE nft_mints n SET status='FAILED',lease_until=NULL,last_error='LEASE_EXPIRED',
          version=n.version+1,updated_at=now() FROM exhausted e WHERE n.id=e.id RETURNING n.id`,
        [options.maxAttempts],
      );
      const jobs = await executor.query<MintJob>(
        `WITH candidate AS (
          SELECT id FROM nft_mints WHERE attempts < $1
          AND ((status='PENDING' AND next_attempt_at <= now()) OR (status='MINTING' AND lease_until <= now()))
          ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE nft_mints n SET status='MINTING',attempts=n.attempts+1,version=n.version+1,
          lease_until=now()+($2 * interval '1 millisecond'),updated_at=now()
          FROM candidate c WHERE n.id=c.id RETURNING n.*`,
        [options.maxAttempts, options.leaseMs],
      );
      return jobs[0] ?? null;
    });
  }

  async complete(job: MintJob, result: MintResult): Promise<boolean> {
    const updated = await this.tickets.pool.query(
      `UPDATE nft_mints SET status='MINTED',provider=$3,token_id=$4,tx_hash=$5,
       metadata_uri=$6,mock_reference=$7,lease_until=NULL,last_error=NULL,version=version+1,updated_at=now()
       WHERE id=$1::uuid AND version=$2 AND status='MINTING' AND lease_until>now() RETURNING id`,
      [
        job.id,
        job.version,
        result.provider,
        result.tokenId,
        result.txHash,
        result.metadataUri,
        result.mockReference,
      ],
    );
    return updated.rowCount === 1;
  }

  async fail(job: MintJob, maxAttempts: number, delayMs: number): Promise<boolean> {
    const updated = await this.tickets.pool.query(
      `UPDATE nft_mints SET status=CASE WHEN attempts >= $3 THEN 'FAILED' ELSE 'PENDING' END,
       next_attempt_at=now()+($4 * interval '1 millisecond'),lease_until=NULL,last_error='MINT_FAILED',
       version=version+1,updated_at=now()
       WHERE id=$1::uuid AND version=$2 AND status='MINTING' AND lease_until>now() RETURNING id`,
      [job.id, job.version, maxAttempts, delayMs],
    );
    return updated.rowCount === 1;
  }
}
