-- CreateTable
CREATE TABLE "ticket_issuances" (
    "order_id" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_issuances_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "unit_index" INTEGER NOT NULL,
    "event_id" UUID NOT NULL,
    "organizer_id" UUID,
    "item_type" TEXT NOT NULL,
    "ref_id" UUID NOT NULL,
    "seat_id" UUID,
    "owner_user_id" UUID NOT NULL,
    "unit_price_vnd" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "secret_version" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_secrets" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "secret_enc" BYTEA NOT NULL,
    "key_id" TEXT NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "message_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "message_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("message_id","consumer")
);

-- CreateIndex
CREATE INDEX "tickets_order_id_idx" ON "tickets"("order_id");

-- CreateIndex
CREATE INDEX "tickets_owner_user_id_id_idx" ON "tickets"("owner_user_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ticket_order_item_unit" ON "tickets"("order_item_id", "unit_index");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ticket_secret_version" ON "ticket_secrets"("ticket_id", "version");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "ticket_issuances"("order_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_secrets" ADD CONSTRAINT "ticket_secrets_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE tickets ADD CONSTRAINT ck_ticket_status
  CHECK (status IN ('ACTIVE','FROZEN','CHECKED_IN','REVOKED','REFUNDED'));
ALTER TABLE tickets ADD CONSTRAINT ck_ticket_unit
  CHECK (unit_index > 0 AND secret_version > 0 AND version > 0 AND unit_price_vnd >= 0);
ALTER TABLE tickets ADD CONSTRAINT ck_ticket_item
  CHECK ((item_type = 'TICKET_SEAT' AND seat_id IS NOT NULL AND seat_id = ref_id AND unit_index = 1)
      OR (item_type = 'TICKET_GA' AND seat_id IS NULL));
ALTER TABLE ticket_secrets ADD CONSTRAINT ck_ticket_secret
  CHECK (version > 0 AND octet_length(secret_enc) >= 29 AND length(key_id) > 0);
ALTER TABLE ticket_issuances ADD CONSTRAINT ck_issuance_fingerprint
  CHECK (fingerprint ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX uq_ticket_active_seat ON tickets (event_id, seat_id)
  WHERE seat_id IS NOT NULL AND status IN ('ACTIVE','FROZEN','CHECKED_IN');
CREATE INDEX ix_outbox_unpublished ON outbox_events (created_at) WHERE published_at IS NULL;

COMMENT ON COLUMN tickets.order_id IS 'ref:booking_db';
COMMENT ON COLUMN tickets.order_item_id IS 'ref:booking_db';
COMMENT ON COLUMN tickets.event_id IS 'ref:event_db';
COMMENT ON COLUMN tickets.seat_id IS 'ref:event_db';
COMMENT ON COLUMN tickets.ref_id IS 'ref:event_db: seat_id for TICKET_SEAT, ticket_class_id for TICKET_GA';
COMMENT ON COLUMN tickets.owner_user_id IS 'ref:identity_db';
COMMENT ON COLUMN tickets.organizer_id IS 'ref:identity_db; optional tenant_id from the envelope';
