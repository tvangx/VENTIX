import { Injectable } from "@nestjs/common";
import { ProblemException } from "@ticketing/common";
import { SqlExecutor } from "@ticketing/outbox-inbox";
import { CheckinResponse } from "../checkin/checkin.dto";
import { GateContext } from "../gates/gate.repository";
import { VerificationPackage } from "../gates/gate.dto";
import { EncryptedSecret } from "../tickets/ticket-secrets";
import { OfflineBatchView, OfflineDeviceView, RevocationPage, TicketUpdate } from "./offline.dto";

export interface OfflineDevice {
  id: string;
  gate_id: string;
  event_id: string;
  organizer_id: string;
  staff_user_id: string;
  package_id: string;
  secret_enc: Buffer;
  key_id: string;
  issued_at: Date;
  expires_at: Date;
}

@Injectable()
export class OfflineRepository {
  async ownedPackage(executor: SqlExecutor, staffId: string, gateId: string, packageId: string) {
    const [row] = await executor.query<{ fingerprint: string; response: VerificationPackage }>(
      "SELECT fingerprint,response FROM ticket_requests WHERE actor_id=$1::uuid AND scope=$2 AND response->>'package_id'=$3 LIMIT 1",
      [staffId, `gate-package:${gateId}`, packageId],
    );
    if (!row)
      throw new ProblemException(
        "PACKAGE_NOT_FOUND",
        404,
        "Package is unavailable for this staff member and gate",
      );
    return row;
  }

  async register(
    executor: SqlExecutor,
    userId: string,
    gate: GateContext,
    view: OfflineDeviceView,
    encrypted: EncryptedSecret,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO offline_devices (id,gate_id,event_id,organizer_id,staff_user_id,package_id,secret_enc,key_id,issued_at,expires_at)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9::timestamptz,$10::timestamptz)`,
      [
        view.device_id,
        gate.id,
        gate.event_id,
        gate.organizer_id,
        userId,
        view.package_id,
        encrypted.ciphertext,
        encrypted.keyId,
        view.issued_at,
        view.expires_at,
      ],
    );
  }

  async device(executor: SqlExecutor, id: string, userId: string): Promise<OfflineDevice> {
    const [row] = await executor.query<OfflineDevice>(
      "SELECT * FROM offline_devices WHERE id=$1::uuid AND staff_user_id=$2::uuid",
      [id, userId],
    );
    if (!row) throw new ProblemException("OFFLINE_DEVICE_NOT_FOUND", 404, "Device is unavailable");
    return row;
  }

  async cachedBatch(executor: SqlExecutor, batchId: string) {
    await executor.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text,0))", [
      `offline-batch:${batchId}`,
    ]);
    const [row] = await executor.query<{
      fingerprint: string;
      device_id: string;
      response: OfflineBatchView;
    }>("SELECT fingerprint,device_id,response FROM offline_sync_batches WHERE id=$1::uuid", [
      batchId,
    ]);
    return row;
  }

  async batch(
    executor: SqlExecutor,
    device: OfflineDevice,
    view: OfflineBatchView,
    fingerprint: string,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO offline_sync_batches (id,device_id,gate_id,event_id,organizer_id,staff_user_id,fingerprint,record_count,conflict_count,response,received_at)
      VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9,$10::jsonb,$11::timestamptz)`,
      [
        view.batch_id,
        device.id,
        device.gate_id,
        device.event_id,
        device.organizer_id,
        device.staff_user_id,
        fingerprint,
        view.record_count,
        view.conflict_count,
        JSON.stringify(view),
        view.received_at,
      ],
    );
  }

  async lockTickets(executor: SqlExecutor, ids: string[]): Promise<void> {
    await executor.query("SELECT id FROM tickets WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [
      ids,
    ]);
  }

  async previousScan(executor: SqlExecutor, deviceId: string, sourceScanId: string) {
    const [row] = await executor.query<{
      id: string;
      scanned_ticket_id: string;
      result: CheckinResponse["result"];
      scanned_at: Date;
      source_fingerprint: string;
    }>(
      "SELECT id,scanned_ticket_id,result,scanned_at,source_fingerprint FROM checkin_logs WHERE device_id=$1::uuid AND source_scan_id=$2::uuid",
      [deviceId, sourceScanId],
    );
    return row;
  }

  async revocations(
    executor: SqlExecutor,
    gate: GateContext,
    cursor: string | undefined,
    limit: number,
  ): Promise<RevocationPage> {
    const rows = await executor.query<TicketUpdate>(
      `SELECT t.id AS ticket_id,t.status,t.secret_version,
      (t.status<>'ACTIVE' OR $4 OR s.id IS NULL) AS revoked
      FROM tickets t LEFT JOIN ticket_secrets s ON s.ticket_id=t.id AND s.version=t.secret_version AND s.revoked_at IS NULL
      WHERE t.gate_id=$1::uuid AND t.event_id=$2::uuid AND (t.organizer_id IS NULL OR t.organizer_id=$3::uuid)
      AND ($5::uuid IS NULL OR t.id>$5::uuid) AND (t.status<>'ACTIVE' OR $4 OR s.id IS NULL
      OR EXISTS (SELECT 1 FROM ticket_secrets old WHERE old.ticket_id=t.id AND old.revoked_at IS NOT NULL))
      ORDER BY t.id LIMIT $6`,
      [gate.id, gate.event_id, gate.organizer_id, gate.cancelled, cursor ?? null, limit + 1],
    );
    const ticket_updates = rows.slice(0, limit);
    return {
      ticket_updates,
      revoked_ticket_ids: ticket_updates
        .filter((ticket) => ticket.revoked)
        .map((ticket) => ticket.ticket_id),
      next_cursor: rows.length > limit ? ticket_updates[ticket_updates.length - 1].ticket_id : null,
    };
  }
}
