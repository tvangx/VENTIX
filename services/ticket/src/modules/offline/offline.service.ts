import { Injectable } from "@nestjs/common";
import { AuthUser } from "@ticketing/auth-guard";
import { ProblemException, requestContext } from "@ticketing/common";
import { newMessage } from "@ticketing/event-contracts";
import { OutboxService } from "@ticketing/outbox-inbox";
import { constants, createHash, publicEncrypt, randomBytes } from "node:crypto";
import { uuidv7 } from "uuidv7";
import { Counter } from "prom-client";
import { MetricsService } from "../../metrics/metrics";
import { GateRepository } from "../gates/gate.repository";
import { packageKey } from "../gates/package-crypto";
import { TicketIdempotency } from "../tickets/ticket-idempotency";
import { CheckinService } from "../checkin/checkin.service";
import { OfflineKeys } from "./offline-keys";
import {
  OfflineBatchInput,
  OfflineBatchView,
  OfflineDeviceView,
  OfflineScanView,
  RegisterOfflineDevice,
  RevocationQuery,
} from "./offline.dto";
import { OfflineDevice, OfflineRepository } from "./offline.repository";
import {
  offlineKeyLabel,
  offlineScanPayload,
  offlineSigningPayload,
  verifyOfflineSignature,
} from "./offline-protocol";

@Injectable()
export class OfflineService {
  private readonly outbox = new OutboxService();
  private readonly scans: Counter<"result">;
  constructor(
    private readonly repo: OfflineRepository,
    private readonly gates: GateRepository,
    private readonly idempotency: TicketIdempotency,
    private readonly keys: OfflineKeys,
    private readonly checkins: CheckinService,
    metrics: MetricsService,
  ) {
    this.scans = new Counter({
      name: "ticket_offline_scan_responses_total",
      help: "Committed offline scan responses including replays",
      labelNames: ["result"],
      registers: [metrics.registry],
    });
  }

  async register(
    user: AuthUser,
    key: string,
    input: RegisterOfflineDevice,
  ): Promise<OfflineDeviceView> {
    const publicKey = packageKey(input.public_key_pem);
    const canonical = publicKey.export({ type: "spki", format: "pem" }).toString();
    return this.gates.tickets.db.transaction(async (executor) => {
      const gate = await this.gates.gate(executor, input.gate_id, user, true);
      const response = await this.idempotency.run(
        executor,
        user,
        `offline-device:${gate.id}`,
        key,
        { package_id: input.package_id, public_key_pem: canonical },
        async () => {
          const saved = await this.repo.ownedPackage(
            executor,
            user.userId,
            gate.id,
            input.package_id,
          );
          if (
            saved.fingerprint !==
            createHash("sha256").update(JSON.stringify(canonical)).digest("hex")
          )
            throw new ProblemException(
              "PACKAGE_KEY_MISMATCH",
              409,
              "Device key differs from the package key",
            );
          if (Date.parse(saved.response.expires_at) <= (await this.gates.now(executor)).getTime())
            throw new ProblemException(
              "PACKAGE_EXPIRED",
              409,
              "Download a current package before registering a device",
            );
          const metadata = {
            device_id: uuidv7(),
            package_id: input.package_id,
            event_id: gate.event_id,
            gate_id: gate.id,
            issued_at: saved.response.issued_at,
            expires_at: saved.response.expires_at,
          };
          const label = offlineKeyLabel(metadata, user.userId);
          const secret = randomBytes(32);
          try {
            let encrypted;
            try {
              encrypted = this.keys.encrypt(metadata.device_id, 1, secret);
            } catch {
              throw new ProblemException(
                "OFFLINE_KEY_UNAVAILABLE",
                503,
                "Offline signing key cannot be stored",
              );
            }
            const view: OfflineDeviceView = {
              ...metadata,
              server_time: (await this.gates.now(executor)).toISOString(),
              algorithm: "HMAC-SHA256",
              encrypted_key: publicEncrypt(
                {
                  key: publicKey,
                  padding: constants.RSA_PKCS1_OAEP_PADDING,
                  oaepHash: "sha256",
                  oaepLabel: label,
                },
                secret,
              ).toString("base64"),
              oaep_label: label.toString("base64"),
            };
            await this.repo.register(executor, user.userId, gate, view, encrypted);
            const context = requestContext.get();
            await this.outbox.add(
              executor,
              newMessage(
                "AuditRecorded",
                {
                  actor_id: user.userId,
                  action: "OFFLINE_DEVICE_REGISTERED",
                  resource_type: "offline_device",
                  resource_id: metadata.device_id,
                },
                { tenant_id: gate.organizer_id, trace_id: context?.traceId ?? context?.requestId },
              ),
              metadata.device_id,
            );
            return view;
          } finally {
            secret.fill(0);
          }
        },
      );
      return { ...response, server_time: (await this.gates.now(executor)).toISOString() };
    });
  }

  async sync(user: AuthUser, key: string, input: OfflineBatchInput) {
    if (key?.toLowerCase() !== input.batch_id)
      throw new ProblemException(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "Idempotency-Key must equal batch_id",
      );
    const response = await this.gates.tickets.db.transaction(async (executor) => {
      const device = await this.repo.device(executor, input.device_id, user.userId);
      const gate = await this.gates.gate(executor, device.gate_id, user, true, true);
      if (
        device.gate_id !== input.gate_id ||
        device.event_id !== input.event_id ||
        device.package_id !== input.package_id
      )
        throw new ProblemException(
          "OFFLINE_CONTEXT_MISMATCH",
          409,
          "Batch does not match the registered device package and gate",
        );
      this.verify(device, input);
      const fingerprint = createHash("sha256").update(offlineSigningPayload(input)).digest("hex");
      const saved = await this.repo.cachedBatch(executor, input.batch_id);
      let batch: OfflineBatchView;
      if (saved) {
        if (saved.device_id !== device.id || saved.fingerprint !== fingerprint)
          throw new ProblemException(
            "OFFLINE_BATCH_ID_REUSED",
            409,
            "Batch ID was used with different content",
          );
        batch = saved.response;
      } else {
        const now = await this.gates.now(executor);
        if (
          input.scans.some(
            (scan) =>
              Date.parse(scan.scanned_at) < device.issued_at.getTime() ||
              Date.parse(scan.scanned_at) >= device.expires_at.getTime() ||
              Date.parse(scan.scanned_at) > now.getTime() + 30000,
          )
        )
          throw new ProblemException(
            "OFFLINE_SCAN_OUTSIDE_WINDOW",
            400,
            "Scan timestamp must be within the package lifetime and server clock tolerance",
          );
        await this.repo.lockTickets(
          executor,
          input.scans.map((scan) => scan.ticket_id),
        );
        const items: OfflineScanView[] = [];
        for (const scan of input.scans) {
          const scanFingerprint = createHash("sha256")
            .update(JSON.stringify(offlineScanPayload(scan)))
            .digest("hex");
          const previous = await this.repo.previousScan(executor, device.id, scan.scan_id);
          if (previous) {
            if (previous.source_fingerprint !== scanFingerprint)
              throw new ProblemException(
                "OFFLINE_SCAN_ID_REUSED",
                409,
                "Source scan ID was used with different content",
              );
            items.push({
              source_scan_id: scan.scan_id,
              scan_id: previous.id,
              ticket_id: previous.scanned_ticket_id,
              result: previous.result,
              scanned_at: previous.scanned_at.toISOString(),
            });
          } else {
            const result = await this.checkins.record(
              executor,
              user,
              gate,
              {
                version: 1,
                ticket_id: scan.ticket_id,
                secret_version: scan.secret_version,
                token: scan.token,
              },
              new Date(scan.scanned_at),
              {
                batchId: input.batch_id,
                deviceId: device.id,
                sourceScanId: scan.scan_id,
                fingerprint: scanFingerprint,
              },
            );
            items.push({ ...result, source_scan_id: scan.scan_id });
          }
        }
        batch = {
          batch_id: input.batch_id,
          device_id: device.id,
          record_count: items.length,
          conflict_count: items.filter((item) => item.result === "DUPLICATE").length,
          received_at: now.toISOString(),
          items,
        };
        await this.repo.batch(executor, device, batch, fingerprint);
      }
      return { batch, revocations: await this.repo.revocations(executor, gate, undefined, 1000) };
    });
    for (const scan of response.batch.items) this.scans.inc({ result: scan.result });
    return response;
  }

  async revocations(user: AuthUser, deviceId: string, query: RevocationQuery) {
    return this.gates.tickets.db.transaction(async (executor) => {
      const device = await this.repo.device(executor, deviceId, user.userId);
      const gate = await this.gates.gate(executor, device.gate_id, user, true, true);
      return this.repo.revocations(executor, gate, query.cursor, query.limit);
    });
  }

  private verify(device: OfflineDevice, input: OfflineBatchInput): void {
    let secret: Buffer;
    try {
      secret = this.keys.decrypt(device.id, 1, {
        keyId: device.key_id,
        ciphertext: device.secret_enc,
      });
    } catch {
      throw new ProblemException(
        "OFFLINE_KEY_UNAVAILABLE",
        503,
        "Offline signing key cannot be read",
      );
    }
    try {
      if (!verifyOfflineSignature(secret, input))
        throw new ProblemException(
          "INVALID_OFFLINE_SIGNATURE",
          403,
          "Offline batch signature is invalid",
        );
    } finally {
      secret.fill(0);
    }
  }
}
