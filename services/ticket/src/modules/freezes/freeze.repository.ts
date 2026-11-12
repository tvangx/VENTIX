import { Injectable } from "@nestjs/common";
import { SqlExecutor } from "@ticketing/outbox-inbox";
import { FreezeInput } from "./freeze.dto";

export interface FreezableTicket {
  id: string;
  owner_user_id: string;
  event_id: string;
  organizer_id: string | null;
  unit_price_vnd: string;
  status: string;
  version: number;
  event_cancelled: boolean;
}
export interface FreezeBinding {
  id: string;
  ticket_id: string;
  seller_id: string;
  event_id: string;
  organizer_id: string | null;
  original_price_vnd: string;
  status: "FROZEN" | "RELEASED";
  version: number;
}

@Injectable()
export class FreezeRepository {
  async ticket(executor: SqlExecutor, id: string): Promise<FreezableTicket | undefined> {
    const [row] = await executor.query<FreezableTicket>(
      `SELECT t.id,t.owner_user_id,t.event_id,COALESCE(t.organizer_id,e.organizer_id) AS organizer_id,t.unit_price_vnd::text,t.status,t.version,COALESCE(e.cancelled,false) AS event_cancelled
      FROM tickets t LEFT JOIN ticket_events e ON e.id=t.event_id WHERE t.id=$1::uuid FOR UPDATE OF t`,
      [id],
    );
    return row;
  }
  async binding(executor: SqlExecutor, id: string): Promise<FreezeBinding | undefined> {
    const [row] = await executor.query<FreezeBinding>(
      "SELECT id,ticket_id,seller_id,event_id,organizer_id,original_price_vnd::text,status,version FROM ticket_freezes WHERE id=$1::uuid FOR UPDATE",
      [id],
    );
    return row;
  }
  async insert(
    executor: SqlExecutor,
    ticket: FreezableTicket,
    input: FreezeInput,
    status: "FROZEN" | "RELEASED",
  ): Promise<FreezeBinding> {
    const [row] = await executor.query<FreezeBinding>(
      `INSERT INTO ticket_freezes (id,ticket_id,seller_id,event_id,organizer_id,original_price_vnd,status)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::bigint,$7) RETURNING id,ticket_id,seller_id,event_id,organizer_id,original_price_vnd::text,status,version`,
      [
        input.listing_id,
        ticket.id,
        input.seller_id,
        ticket.event_id,
        ticket.organizer_id,
        ticket.unit_price_vnd,
        status,
      ],
    );
    return row;
  }
  async release(executor: SqlExecutor, binding: FreezeBinding): Promise<boolean> {
    const rows = await executor.query(
      "UPDATE ticket_freezes SET status='RELEASED',version=version+1,updated_at=now() WHERE id=$1::uuid AND status='FROZEN' AND version=$2 RETURNING id",
      [binding.id, binding.version],
    );
    return rows.length === 1;
  }
  async status(
    executor: SqlExecutor,
    ticket: FreezableTicket,
    from: string,
    to: string,
  ): Promise<boolean> {
    const rows = await executor.query(
      "UPDATE tickets SET status=$3,version=version+1,updated_at=now() WHERE id=$1::uuid AND status=$2 AND version=$4 RETURNING id",
      [ticket.id, from, to, ticket.version],
    );
    return rows.length === 1;
  }
}
