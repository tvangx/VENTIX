import { Injectable } from "@nestjs/common";
import { AuthUser } from "@ticketing/auth-guard";
import { SqlExecutor } from "@ticketing/outbox-inbox";
import { uuidv7 } from "uuidv7";
import { GateContext } from "../gates/gate.repository";
import { CheckinResult, CheckinResponse } from "./checkin.dto";

export interface ScannedTicket {
  id: string;
  event_id: string;
  organizer_id: string | null;
  gate_id: string | null;
  status: string;
  version: number;
  secret_version: number;
  secret_enc: Buffer | null;
  key_id: string | null;
}

@Injectable()
export class CheckinRepository {
  async ticket(executor: SqlExecutor, id: string): Promise<ScannedTicket | undefined> {
    const [ticket] = await executor.query<ScannedTicket>(
      `SELECT t.id,t.event_id,t.organizer_id,t.gate_id,t.status,t.version,t.secret_version,s.secret_enc,s.key_id
      FROM tickets t LEFT JOIN ticket_secrets s ON s.ticket_id=t.id AND s.version=t.secret_version AND s.revoked_at IS NULL
      WHERE t.id=$1::uuid FOR UPDATE OF t`,
      [id],
    );
    return ticket;
  }

  async accept(executor: SqlExecutor, ticket: ScannedTicket): Promise<boolean> {
    const rows = await executor.query(
      "UPDATE tickets SET status='CHECKED_IN',version=version+1,updated_at=now() WHERE id=$1::uuid AND status='ACTIVE' AND version=$2 RETURNING id",
      [ticket.id, ticket.version],
    );
    return rows.length === 1;
  }

  async log(
    executor: SqlExecutor,
    user: AuthUser,
    gate: GateContext,
    scannedTicketId: string,
    ticketId: string | null,
    result: CheckinResult,
    scannedAt: Date,
  ): Promise<CheckinResponse> {
    const id = uuidv7();
    await executor.query(
      `INSERT INTO checkin_logs (id,ticket_id,scanned_ticket_id,gate_id,event_id,organizer_id,staff_user_id,result,scanned_at)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8,$9::timestamptz)`,
      [
        id,
        ticketId,
        scannedTicketId,
        gate.id,
        gate.event_id,
        gate.organizer_id,
        user.userId,
        result,
        scannedAt,
      ],
    );
    return { scan_id: id, ticket_id: scannedTicketId, result, scanned_at: scannedAt.toISOString() };
  }
}
