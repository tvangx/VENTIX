import { Injectable } from "@nestjs/common";
import { AuthUser } from "@ticketing/auth-guard";
import { ProblemException, requestContext } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService, SqlExecutor } from "@ticketing/outbox-inbox";
import { Counter } from "prom-client";
import { MetricsService } from "../../metrics/metrics";
import { GateContext, GateRepository } from "../gates/gate.repository";
import { TicketIdempotency } from "../tickets/ticket-idempotency";
import { TicketSecrets } from "../tickets/ticket-secrets";
import { verifyTotp } from "../tickets/totp";
import { CheckinInput, CheckinResponse, CheckinResult } from "./checkin.dto";
import { CheckinRepository, ScannedTicket } from "./checkin.repository";

@Injectable()
export class CheckinService {
  private readonly outbox = new OutboxService();
  private readonly scans: Counter<"result">;
  constructor(
    private readonly repo: CheckinRepository,
    private readonly gates: GateRepository,
    private readonly idempotency: TicketIdempotency,
    private readonly secrets: TicketSecrets,
    metrics: MetricsService,
  ) {
    this.scans = new Counter({
      name: "ticket_online_checkin_responses_total",
      help: "Committed online check-in responses including idempotent replays",
      labelNames: ["result"],
      registers: [metrics.registry],
    });
  }

  async scan(user: AuthUser, key: string, input: CheckinInput): Promise<CheckinResponse> {
    const response = await this.gates.tickets.db.transaction(async (executor) => {
      const gate = await this.gates.gate(executor, input.gate_id, user, true);
      if (gate.event_id !== input.event_id)
        throw new ProblemException("GATE_EVENT_MISMATCH", 409, "Gate belongs to a different event");
      const payload = {
        event_id: input.event_id,
        gate_id: input.gate_id,
        qr: {
          version: input.qr.version,
          ticket_id: input.qr.ticket_id,
          secret_version: input.qr.secret_version,
          token: input.qr.token,
        },
      };
      return this.idempotency.run(executor, user, "online-checkin", key, payload, async () => {
        const ticket = await this.repo.ticket(executor, input.qr.ticket_id);
        const scannedAt = await this.gates.now(executor);
        const result = this.result(ticket, gate, input, scannedAt);
        if (result === "ACCEPTED") {
          if (!(await this.repo.accept(executor, ticket!)))
            throw new ProblemException(
              "TICKET_STATE_CONFLICT",
              409,
              "Ticket changed during check-in",
            );
        }
        const response = await this.repo.log(
          executor,
          user,
          gate,
          input.qr.ticket_id,
          ticket?.id ?? null,
          result,
          scannedAt,
        );
        if (result === "ACCEPTED") await this.publish(executor, gate, response);
        return response;
      });
    });
    this.scans.inc({ result: response.result });
    return response;
  }

  private result(
    ticket: ScannedTicket | undefined,
    gate: GateContext,
    input: CheckinInput,
    scannedAt: Date,
  ): CheckinResult {
    if (!ticket) return "INVALID";
    if (
      ticket.event_id !== gate.event_id ||
      (ticket.organizer_id !== null && ticket.organizer_id !== gate.organizer_id)
    )
      return "WRONG_EVENT";
    if (ticket.gate_id !== gate.id) return "WRONG_GATE";
    if (ticket.status === "CHECKED_IN") return "DUPLICATE";
    if (ticket.status !== "ACTIVE" || ticket.secret_version !== input.qr.secret_version)
      return "INVALID";
    if (!ticket.secret_enc || !ticket.key_id)
      throw new ProblemException(
        "TICKET_SECRET_UNAVAILABLE",
        503,
        "Current ticket secret is unavailable",
      );
    let secret: Buffer;
    try {
      secret = this.secrets.decrypt(ticket.id, ticket.secret_version, {
        keyId: ticket.key_id,
        ciphertext: ticket.secret_enc,
      });
    } catch {
      throw new ProblemException(
        "TICKET_SECRET_UNAVAILABLE",
        503,
        "Current ticket secret is unavailable",
      );
    }
    try {
      return verifyTotp(secret, input.qr.token, Math.floor(scannedAt.getTime() / 1000))
        ? "ACCEPTED"
        : "INVALID";
    } finally {
      secret.fill(0);
    }
  }

  private async publish(
    executor: SqlExecutor,
    gate: GateContext,
    response: CheckinResponse,
  ): Promise<void> {
    const context = requestContext.get();
    await this.outbox.add(
      executor,
      newMessage(
        "TicketCheckedIn",
        {
          ticket_id: response.ticket_id,
          event_id: gate.event_id,
          gate_id: gate.id,
          scanned_at: response.scanned_at,
          offline: false,
        },
        { tenant_id: gate.organizer_id, trace_id: context?.traceId ?? context?.requestId },
      ),
      response.ticket_id,
    );
  }
}
