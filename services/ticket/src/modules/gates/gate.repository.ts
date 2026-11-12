import { Injectable } from "@nestjs/common";
import { AuthUser, assertSameOrganizer } from "@ticketing/auth-guard";
import { ProblemException } from "@ticketing/common";
import { SqlExecutor } from "@ticketing/outbox-inbox";
import { uuidv7 } from "uuidv7";
import { AssignmentView, GateQuery, GateView } from "./gate.dto";
import { TicketRepository } from "../tickets/ticket.repository";

export interface GateContext extends GateView {
  organizer_id: string;
  cancelled: boolean;
}
export interface GateSecret {
  id: string;
  status: string;
  secret_version: number;
  secret_enc: Buffer | null;
  key_id: string | null;
}

@Injectable()
export class GateRepository {
  constructor(readonly tickets: TicketRepository) {}

  async event(executor: SqlExecutor, eventId: string, user: AuthUser): Promise<string> {
    const [event] = await executor.query<{ organizer_id: string; cancelled: boolean }>(
      "SELECT organizer_id,cancelled FROM ticket_events WHERE id=$1::uuid FOR SHARE",
      [eventId],
    );
    if (!event)
      throw new ProblemException("EVENT_NOT_READY", 409, "Event lifecycle has not arrived");
    if (!user.roles.includes("ADMIN")) assertSameOrganizer(user, event.organizer_id);
    if (event.cancelled) throw new ProblemException("EVENT_CANCELLED", 409, "Event is cancelled");
    return event.organizer_id;
  }

  async gate(
    executor: SqlExecutor,
    gateId: string,
    user: AuthUser,
    staff: boolean,
  ): Promise<GateContext> {
    const [gate] = await executor.query<GateContext>(
      `SELECT g.id,g.event_id,g.name,e.organizer_id,e.cancelled FROM gates g
       JOIN ticket_events e ON e.id=g.event_id WHERE g.id=$1::uuid FOR UPDATE OF g FOR SHARE OF e`,
      [gateId],
    );
    if (!gate) throw new ProblemException("GATE_NOT_FOUND", 404, "Gate is unavailable");
    if (staff || !user.roles.includes("ADMIN")) assertSameOrganizer(user, gate.organizer_id);
    if (gate.cancelled) throw new ProblemException("EVENT_CANCELLED", 409, "Event is cancelled");
    if (staff) {
      const assignments = await executor.query(
        "SELECT id FROM staff_assignments WHERE gate_id=$1::uuid AND staff_user_id=$2::uuid AND revoked_at IS NULL",
        [gateId, user.userId],
      );
      if (assignments.length === 0)
        throw new ProblemException("GATE_NOT_ASSIGNED", 403, "Staff is not assigned to this gate");
    }
    return gate;
  }

  async create(
    executor: SqlExecutor,
    eventId: string,
    organizerId: string,
    name: string,
  ): Promise<GateView> {
    const [gate] = await executor.query<GateView>(
      "INSERT INTO gates (id,event_id,organizer_id,name) VALUES ($1::uuid,$2::uuid,$3::uuid,$4) RETURNING id,event_id,name",
      [uuidv7(), eventId, organizerId, name],
    );
    return gate;
  }

  async staff(
    executor: SqlExecutor,
    gate: GateContext,
    staffId: string,
    revoke: boolean,
  ): Promise<AssignmentView> {
    const [row] = await executor.query<{
      id: string;
      gate_id: string;
      staff_user_id: string;
      revoked_at: Date | null;
    }>(
      `INSERT INTO staff_assignments (id,gate_id,event_id,staff_user_id,revoked_at,organizer_id)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,CASE WHEN $5 THEN now() ELSE NULL END,$6::uuid)
       ON CONFLICT (gate_id,staff_user_id) DO UPDATE SET revoked_at=CASE WHEN $5 THEN COALESCE(staff_assignments.revoked_at,now()) ELSE NULL END,
       version=staff_assignments.version+1,updated_at=now() RETURNING id,gate_id,staff_user_id,revoked_at`,
      [uuidv7(), gate.id, gate.event_id, staffId, revoke, gate.organizer_id],
    );
    return { ...row, revoked_at: row.revoked_at?.toISOString() ?? null };
  }

  async assignTickets(executor: SqlExecutor, gate: GateContext, ids: string[]): Promise<void> {
    const rows = await executor.query<{
      id: string;
      event_id: string;
      organizer_id: string | null;
      gate_id: string | null;
    }>(
      "SELECT id,event_id,organizer_id,gate_id FROM tickets WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [ids],
    );
    if (
      rows.length !== ids.length ||
      rows.some(
        (row) =>
          row.event_id !== gate.event_id ||
          (row.organizer_id !== null && row.organizer_id !== gate.organizer_id),
      )
    )
      throw new ProblemException(
        "TICKET_EVENT_MISMATCH",
        409,
        "All tickets must belong to the gate event and organizer",
      );
    if (rows.some((row) => row.gate_id !== null && row.gate_id !== gate.id))
      throw new ProblemException("TICKET_GATE_ALREADY_ASSIGNED", 409, "Ticket already has a gate");
    await executor.query(
      "UPDATE tickets SET gate_id=$2::uuid,version=version+1,updated_at=now() WHERE id=ANY($1::uuid[]) AND gate_id IS NULL",
      [ids, gate.id],
    );
  }

  async secrets(
    executor: SqlExecutor,
    gate: GateContext,
    maxTickets: number,
  ): Promise<GateSecret[]> {
    const rows = await executor.query<GateSecret>(
      `SELECT t.id,t.status,t.secret_version,s.secret_enc,s.key_id FROM tickets t
       LEFT JOIN ticket_secrets s ON s.ticket_id=t.id AND s.version=t.secret_version AND s.revoked_at IS NULL
       WHERE t.gate_id=$1::uuid AND t.event_id=$2::uuid AND (t.organizer_id IS NULL OR t.organizer_id=$3::uuid)
       AND t.status='ACTIVE' ORDER BY t.id LIMIT $4 FOR SHARE OF t`,
      [gate.id, gate.event_id, gate.organizer_id, maxTickets + 1],
    );
    if (rows.length > maxTickets)
      throw new ProblemException(
        "PACKAGE_TOO_LARGE",
        409,
        "Gate exceeds the configured package ticket limit",
      );
    return rows;
  }

  async now(executor: SqlExecutor): Promise<Date> {
    const [row] = await executor.query<{ now: Date }>("SELECT clock_timestamp() AS now");
    return row.now;
  }

  async list(user: AuthUser, query: GateQuery): Promise<GateView[]> {
    return (
      await this.tickets.pool.query<GateView>(
        `SELECT g.id,g.event_id,g.name FROM gates g JOIN ticket_events e ON e.id=g.event_id
       JOIN staff_assignments a ON a.gate_id=g.id AND a.staff_user_id=$1::uuid AND a.revoked_at IS NULL
       WHERE e.organizer_id=$2::uuid AND NOT e.cancelled AND ($3::uuid IS NULL OR g.id>$3::uuid) ORDER BY g.id LIMIT $4`,
        [user.userId, user.organizerId ?? null, query.cursor ?? null, query.limit + 1],
      )
    ).rows;
  }
}
