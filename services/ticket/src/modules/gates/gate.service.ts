import { Inject, Injectable } from "@nestjs/common";
import { AuthUser } from "@ticketing/auth-guard";
import { ProblemException, requestContext } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService, SqlExecutor } from "@ticketing/outbox-inbox";
import { createHash } from "node:crypto";
import { z } from "zod";
import { uuidv7 } from "uuidv7";
import { ENV } from "../../app.tokens";
import { Env } from "../../config/env.schema";
import { TicketSecrets } from "../tickets/ticket-secrets";
import { GateContext, GateRepository } from "./gate.repository";
import {
  AssignmentView,
  CreateGate,
  GateQuery,
  GateView,
  TicketAssignmentView,
  VerificationPackage,
} from "./gate.dto";
import { encryptPackage, packageKey } from "./package-crypto";

@Injectable()
export class GateService {
  private readonly outbox = new OutboxService();
  constructor(
    private readonly repo: GateRepository,
    private readonly secrets: TicketSecrets,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async request<T>(
    executor: SqlExecutor,
    user: AuthUser,
    scope: string,
    key: string,
    payload: unknown,
    perform: () => Promise<T>,
  ): Promise<T> {
    if (!z.string().uuid().safeParse(key).success)
      throw new ProblemException(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "A UUID Idempotency-Key is required",
      );
    const fingerprint = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const cached = await this.repo.cached(executor, user.userId, scope, key);
    if (cached) {
      if (cached.fingerprint !== fingerprint)
        throw new ProblemException(
          "IDEMPOTENCY_KEY_REUSED",
          409,
          "Request key was used with different input",
        );
      return cached.response as T;
    }
    const response = await perform();
    await this.repo.remember(executor, user.userId, scope, key, fingerprint, response);
    return response;
  }

  private async audit(
    executor: SqlExecutor,
    user: AuthUser,
    organizerId: string,
    resourceId: string,
    action: string,
  ): Promise<void> {
    const context = requestContext.get();
    await this.outbox.add(
      executor,
      newMessage(
        "AuditRecorded",
        {
          actor_id: user.userId,
          action,
          resource_type: "gate",
          resource_id: resourceId,
        },
        { tenant_id: organizerId, trace_id: context?.traceId ?? context?.requestId },
      ),
      resourceId,
    );
  }

  async create(user: AuthUser, key: string, input: CreateGate): Promise<GateView> {
    try {
      return await this.repo.tickets.db.transaction(async (executor) => {
        const organizerId = await this.repo.event(executor, input.event_id, user);
        return this.request(executor, user, "gate-create", key, input, async () => {
          const gate = await this.repo.create(executor, input.event_id, organizerId, input.name);
          await this.audit(executor, user, organizerId, gate.id, "GATE_CREATED");
          return gate;
        });
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23505")
        throw new ProblemException(
          "GATE_NAME_EXISTS",
          409,
          "Event already has a gate with that name",
        );
      throw error;
    }
  }

  async assign(
    user: AuthUser,
    key: string,
    gateId: string,
    staffId: string,
    revoke: boolean,
  ): Promise<AssignmentView> {
    return this.repo.tickets.db.transaction(async (executor) => {
      const gate = await this.repo.gate(executor, gateId, user, false);
      return this.request(
        executor,
        user,
        `gate-staff:${gateId}`,
        key,
        { staffId, revoke },
        async () => {
          const assignment = await this.repo.staff(executor, gate, staffId, revoke);
          await this.audit(
            executor,
            user,
            gate.organizer_id,
            gateId,
            revoke ? "GATE_STAFF_REVOKED" : "GATE_STAFF_ASSIGNED",
          );
          return assignment;
        },
      );
    });
  }

  async assignTickets(
    user: AuthUser,
    key: string,
    gateId: string,
    ticketIds: string[],
  ): Promise<TicketAssignmentView> {
    const ids = [...ticketIds].sort();
    return this.repo.tickets.db.transaction(async (executor) => {
      const gate = await this.repo.gate(executor, gateId, user, false);
      return this.request(executor, user, `gate-tickets:${gateId}`, key, ids, async () => {
        await this.repo.assignTickets(executor, gate, ids);
        await this.audit(executor, user, gate.organizer_id, gateId, "GATE_TICKETS_ASSIGNED");
        return { gate_id: gateId, assigned_count: ids.length };
      });
    });
  }

  async list(user: AuthUser, query: GateQuery) {
    const rows = await this.repo.list(user, query);
    const items = rows.slice(0, query.limit);
    return { items, next_cursor: rows.length > query.limit ? items[items.length - 1].id : null };
  }

  async verificationPackage(
    user: AuthUser,
    key: string,
    gateId: string,
    publicKeyPem: string,
  ): Promise<VerificationPackage> {
    const publicKey = packageKey(publicKeyPem).export({ type: "spki", format: "pem" }).toString();
    return this.repo.tickets.db.transaction(async (executor) => {
      const gate = await this.repo.gate(executor, gateId, user, true);
      const response = await this.request(
        executor,
        user,
        `gate-package:${gateId}`,
        key,
        publicKey,
        async () => {
          const result = await this.encrypt(executor, gate, publicKey);
          await this.audit(executor, user, gate.organizer_id, gateId, "GATE_PACKAGE_ISSUED");
          return result;
        },
      );
      if (Date.parse(response.expires_at) <= (await this.repo.now(executor)).getTime())
        throw new ProblemException(
          "PACKAGE_EXPIRED",
          409,
          "Use a new request key to download a current package",
        );
      return response;
    });
  }

  private async encrypt(
    executor: SqlExecutor,
    gate: GateContext,
    publicKey: string,
  ): Promise<VerificationPackage> {
    const rows = await this.repo.secrets(executor, gate, this.env.TICKET_PACKAGE_MAX_TICKETS);
    const tickets = rows.map((row) => {
      if (!row.key_id || !row.secret_enc)
        throw new ProblemException(
          "TICKET_SECRET_UNAVAILABLE",
          503,
          "A current ticket secret is unavailable",
        );
      let secret: Buffer;
      try {
        secret = this.secrets.decrypt(row.id, row.secret_version, {
          keyId: row.key_id,
          ciphertext: row.secret_enc,
        });
      } catch {
        throw new ProblemException(
          "TICKET_SECRET_UNAVAILABLE",
          503,
          "A current ticket secret is unavailable",
        );
      }
      try {
        return {
          ticket_id: row.id,
          status: row.status,
          secret_version: row.secret_version,
          secret: secret.toString("base64"),
        };
      } finally {
        secret.fill(0);
      }
    });
    const issued = await this.repo.now(executor);
    const metadata = {
      package_id: uuidv7(),
      event_id: gate.event_id,
      gate_id: gate.id,
      issued_at: issued.toISOString(),
      expires_at: new Date(
        issued.getTime() + this.env.TICKET_PACKAGE_TTL_SECONDS * 1000,
      ).toISOString(),
    };
    const plaintext = Buffer.from(
      JSON.stringify({
        ...metadata,
        totp: { algorithm: "SHA1", digits: 6, period_seconds: 30, window: 1 },
        tickets,
      }),
    );
    try {
      return encryptPackage(metadata, plaintext, publicKey);
    } finally {
      plaintext.fill(0);
    }
  }
}
