-- AlterTable
ALTER TABLE "checkin_logs" ADD COLUMN     "batch_id" UUID,
ADD COLUMN     "device_id" UUID,
ADD COLUMN     "source_fingerprint" VARCHAR(64),
ADD COLUMN     "source_scan_id" UUID;

-- CreateTable
CREATE TABLE "offline_devices" (
    "id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "secret_enc" BYTEA NOT NULL,
    "key_id" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_sync_batches" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "record_count" INTEGER NOT NULL,
    "conflict_count" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_sync_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offline_devices_staff_user_id_id_idx" ON "offline_devices"("staff_user_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX uq_offline_device_context ON offline_devices(id,gate_id,event_id,organizer_id,staff_user_id);
CREATE UNIQUE INDEX uq_offline_batch_context ON offline_sync_batches(id,device_id,gate_id,event_id,organizer_id,staff_user_id);

-- AddForeignKey
ALTER TABLE checkin_logs ADD CONSTRAINT fk_checkin_offline_batch FOREIGN KEY (batch_id,device_id,gate_id,event_id,organizer_id,staff_user_id) REFERENCES offline_sync_batches(id,device_id,gate_id,event_id,organizer_id,staff_user_id) ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

-- AddForeignKey
ALTER TABLE checkin_logs ADD CONSTRAINT fk_checkin_device FOREIGN KEY (device_id,gate_id,event_id,organizer_id,staff_user_id) REFERENCES offline_devices(id,gate_id,event_id,organizer_id,staff_user_id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_devices" ADD CONSTRAINT "offline_devices_gate_id_event_id_organizer_id_fkey" FOREIGN KEY ("gate_id", "event_id", "organizer_id") REFERENCES "gates"("id", "event_id", "organizer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE offline_sync_batches ADD CONSTRAINT fk_offline_batch_device FOREIGN KEY (device_id,gate_id,event_id,organizer_id,staff_user_id) REFERENCES offline_devices(id,gate_id,event_id,organizer_id,staff_user_id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX uq_offline_source_scan ON checkin_logs(device_id,source_scan_id) WHERE offline;
CREATE INDEX idx_ticket_gate_delta ON tickets(gate_id,id) WHERE gate_id IS NOT NULL;
CREATE INDEX idx_ticket_package_lookup ON ticket_requests(actor_id,scope,(response->>'package_id'));

ALTER TABLE offline_devices ADD CONSTRAINT ck_offline_device_valid CHECK (expires_at>issued_at AND octet_length(secret_enc)=60 AND length(key_id)>0);
ALTER TABLE offline_sync_batches ADD CONSTRAINT ck_offline_batch_valid CHECK (record_count BETWEEN 1 AND 500 AND conflict_count BETWEEN 0 AND record_count AND fingerprint ~ '^[0-9a-f]{64}$' AND jsonb_typeof(response)='object');
ALTER TABLE checkin_logs ADD CONSTRAINT ck_offline_scan_metadata CHECK (
  (offline AND batch_id IS NOT NULL AND device_id IS NOT NULL AND source_scan_id IS NOT NULL AND source_fingerprint IS NOT NULL AND source_fingerprint ~ '^[0-9a-f]{64}$')
  OR (NOT offline AND batch_id IS NULL AND device_id IS NULL AND source_scan_id IS NULL AND source_fingerprint IS NULL)
);

CREATE FUNCTION reject_offline_batch_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'offline_sync_batches is append-only' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER offline_batches_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON offline_sync_batches FOR EACH STATEMENT EXECUTE FUNCTION reject_offline_batch_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON offline_sync_batches FROM ticket_user;
GRANT UPDATE(id) ON offline_sync_batches TO ticket_user;
COMMENT ON COLUMN offline_devices.staff_user_id IS 'ref:identity_db';
COMMENT ON COLUMN offline_sync_batches.staff_user_id IS 'ref:identity_db';
