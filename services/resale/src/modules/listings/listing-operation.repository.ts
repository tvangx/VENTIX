import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { SqlExecutor } from "@ticketing/outbox-inbox";
import { uuidv7 } from "uuidv7";
import { ListingView } from "./listing.dto";
import { ListingRepository } from "./listing.repository";

export interface ListingOperation {
  id: string;
  seller_id: string;
  scope: string;
  request_key: string;
  fingerprint: string;
  kind: "CREATE" | "CANCEL";
  state: "PENDING" | "FROZEN" | "RELEASING" | "COMPLETED" | "FAILED";
  ticket_id: string;
  listing_id: string;
  ask_price_vnd: string;
  event_id: string | null;
  organizer_id: string | null;
  original_price_vnd: string | null;
  max_percent: number | null;
  response: ListingView | null;
  failure_code: string | null;
  failure_status: number | null;
  attempts: number;
  trace_id: string | null;
  version: number;
}
export type OperationChanges = Partial<
  Pick<
    ListingOperation,
    | "state"
    | "event_id"
    | "organizer_id"
    | "original_price_vnd"
    | "max_percent"
    | "response"
    | "failure_code"
    | "failure_status"
  >
>;
const operationColumns =
  "id,seller_id,scope,request_key,fingerprint,kind,state,ticket_id,listing_id,ask_price_vnd::text,event_id,organizer_id,original_price_vnd::text,max_percent,response,failure_code,failure_status,attempts,trace_id,version";
const listingColumns =
  "id,ticket_id,event_id,original_price_vnd::text,ask_price_vnd::text,max_percent,status,version";

@Injectable()
export class ListingOperationRepository {
  constructor(readonly listings: ListingRepository) {}

  async request(
    executor: SqlExecutor,
    sellerId: string,
    scope: string,
    key: string,
  ): Promise<ListingOperation | undefined> {
    const [row] = await executor.query<ListingOperation>(
      `SELECT ${operationColumns} FROM listing_operations WHERE seller_id=$1::uuid AND scope=$2 AND request_key=$3::uuid FOR UPDATE`,
      [sellerId, scope, key],
    );
    return row;
  }
  async peek(id: string): Promise<ListingOperation> {
    const result = await this.listings.pool.query<ListingOperation>(
      `SELECT ${operationColumns} FROM listing_operations WHERE id=$1::uuid`,
      [id],
    );
    if (!result.rows[0])
      throw new ProblemException(
        "LISTING_OPERATION_NOT_FOUND",
        404,
        "Listing operation is unavailable",
      );
    return result.rows[0];
  }
  async locked(executor: SqlExecutor, id: string): Promise<ListingOperation> {
    const [row] = await executor.query<ListingOperation>(
      `SELECT ${operationColumns} FROM listing_operations WHERE id=$1::uuid FOR UPDATE`,
      [id],
    );
    if (!row)
      throw new ProblemException(
        "LISTING_OPERATION_NOT_FOUND",
        404,
        "Listing operation is unavailable",
      );
    return row;
  }
  async pending(executor: SqlExecutor, ticketId: string): Promise<boolean> {
    return (
      (
        await executor.query(
          "SELECT id FROM listing_operations WHERE ticket_id=$1::uuid AND state IN ('PENDING','FROZEN','RELEASING') LIMIT 1",
          [ticketId],
        )
      ).length > 0
    );
  }
  async invalidated(executor: SqlExecutor, ticketId: string): Promise<boolean> {
    return (
      (
        await executor.query("SELECT id FROM resale_ticket_invalidations WHERE id=$1::uuid", [
          ticketId,
        ])
      ).length > 0
    );
  }
  async active(executor: SqlExecutor, ticketId: string): Promise<boolean> {
    return (
      (
        await executor.query(
          "SELECT id FROM listings WHERE ticket_id=$1::uuid AND status='ACTIVE' LIMIT 1",
          [ticketId],
        )
      ).length > 0
    );
  }
  async insert(
    executor: SqlExecutor,
    input: {
      sellerId: string;
      scope: string;
      key: string;
      fingerprint: string;
      kind: "CREATE" | "CANCEL";
      ticketId: string;
      listingId?: string;
      askPrice: string;
      traceId: string;
    },
  ): Promise<ListingOperation> {
    const rows = await executor.query<ListingOperation>(
      `INSERT INTO listing_operations (id,seller_id,scope,request_key,fingerprint,kind,ticket_id,listing_id,ask_price_vnd,trace_id)
      VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5,$6,$7::uuid,$8::uuid,$9::bigint,$10)
      ON CONFLICT (seller_id,scope,request_key) DO NOTHING RETURNING ${operationColumns}`,
      [
        uuidv7(),
        input.sellerId,
        input.scope,
        input.key,
        input.fingerprint,
        input.kind,
        input.ticketId,
        input.listingId ?? uuidv7(),
        input.askPrice,
        input.traceId,
      ],
    );
    if (rows[0]) return rows[0];
    const existing = await this.request(executor, input.sellerId, input.scope, input.key);
    if (!existing || existing.fingerprint !== input.fingerprint)
      throw new ProblemException(
        "IDEMPOTENCY_KEY_REUSED",
        409,
        "Request key was used with different input",
      );
    return existing;
  }
  async save(
    executor: SqlExecutor,
    operation: ListingOperation,
    changes: OperationChanges,
  ): Promise<ListingOperation> {
    const next = { ...operation, ...changes, version: operation.version + 1 };
    const rows = await executor.query(
      `UPDATE listing_operations SET state=$2,event_id=$3::uuid,organizer_id=$4::uuid,original_price_vnd=$5::bigint,max_percent=$6,
      response=$7::jsonb,failure_code=$8,failure_status=$9,version=version+1,updated_at=now()
      WHERE id=$1::uuid AND state=$10 AND version=$11 RETURNING id`,
      [
        operation.id,
        next.state,
        next.event_id,
        next.organizer_id,
        next.original_price_vnd,
        next.max_percent,
        next.response === null ? null : JSON.stringify(next.response),
        next.failure_code,
        next.failure_status,
        operation.state,
        operation.version,
      ],
    );
    if (rows.length !== 1)
      throw new ProblemException("LISTING_OPERATION_CONFLICT", 409, "Listing operation changed");
    return next;
  }
  async ownedListing(
    executor: SqlExecutor,
    id: string,
    sellerId: string,
    lock = false,
  ): Promise<ListingView | undefined> {
    const [row] = await executor.query<ListingView>(
      `SELECT ${listingColumns} FROM listings WHERE id=$1::uuid AND seller_id=$2::uuid${lock ? " FOR UPDATE" : ""}`,
      [id, sellerId],
    );
    return row;
  }
  async cancelListing(executor: SqlExecutor, listing: ListingView): Promise<ListingView> {
    if (listing.status !== "ACTIVE") return listing;
    const [row] = await executor.query<ListingView>(
      `UPDATE listings SET status='CANCELLED',version=version+1,updated_at=now() WHERE id=$1::uuid AND status='ACTIVE' AND version=$2 RETURNING ${listingColumns}`,
      [listing.id, listing.version],
    );
    if (!row)
      throw new ProblemException("LISTING_STATE_CONFLICT", 409, "Listing changed while cancelling");
    return row;
  }
  async cap(executor: SqlExecutor, eventId: string): Promise<number> {
    const [row] = await executor.query<{ max_percent: number }>(
      "SELECT max_percent FROM price_cap_rules WHERE event_id=$1::uuid FOR SHARE",
      [eventId],
    );
    return row?.max_percent ?? 120;
  }
  async createListing(executor: SqlExecutor, operation: ListingOperation): Promise<ListingView> {
    const [row] = await executor.query<ListingView>(
      `INSERT INTO listings (id,ticket_id,seller_id,event_id,organizer_id,original_price_vnd,ask_price_vnd,max_percent,status)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::bigint,$7::bigint,$8,'ACTIVE') RETURNING ${listingColumns}`,
      [
        operation.listing_id,
        operation.ticket_id,
        operation.seller_id,
        operation.event_id,
        operation.organizer_id,
        operation.original_price_vnd,
        operation.ask_price_vnd,
        operation.max_percent,
      ],
    );
    return row;
  }
  async defer(id: string): Promise<void> {
    await this.listings.pool.query(
      `UPDATE listing_operations SET attempts=attempts+1,next_attempt_at=clock_timestamp()+make_interval(secs=>LEAST(60,power(2,LEAST(attempts,6)))::double precision),updated_at=now(),version=version+1
      WHERE id=$1::uuid AND state NOT IN ('COMPLETED','FAILED')`,
      [id],
    );
  }
  async due(): Promise<string[]> {
    return (
      await this.listings.pool.query<{ id: string }>(
        "SELECT id FROM listing_operations WHERE state IN ('PENDING','FROZEN','RELEASING') AND next_attempt_at<=clock_timestamp() ORDER BY created_at,id LIMIT 10",
      )
    ).rows.map((row) => row.id);
  }
}
