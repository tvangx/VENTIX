-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "original_price_vnd" BIGINT NOT NULL,
    "ask_price_vnd" BIGINT NOT NULL,
    "max_percent" INTEGER NOT NULL DEFAULT 120,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_cap_rules" (
    "event_id" UUID NOT NULL,
    "max_percent" INTEGER NOT NULL DEFAULT 120,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "price_cap_rules_pkey" PRIMARY KEY ("event_id")
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
CREATE INDEX "listings_seller_id_id_idx" ON "listings"("seller_id", "id");

ALTER TABLE listings ADD CONSTRAINT ck_listing_status CHECK (status IN ('ACTIVE','SOLD','CANCELLED','EXPIRED'));
ALTER TABLE listings ADD CONSTRAINT ck_listing_price CHECK (
  original_price_vnd >= 0 AND ask_price_vnd >= 0 AND max_percent BETWEEN 1 AND 120
  AND ask_price_vnd::numeric * 100 <= original_price_vnd::numeric * max_percent AND version > 0
);
ALTER TABLE price_cap_rules ADD CONSTRAINT ck_price_cap_rule CHECK (max_percent BETWEEN 1 AND 120 AND version > 0);
CREATE UNIQUE INDEX uq_listing_active_ticket ON listings(ticket_id) WHERE status='ACTIVE';
CREATE INDEX ix_outbox_unpublished ON outbox_events(created_at) WHERE published_at IS NULL;
COMMENT ON COLUMN listings.ticket_id IS 'ref:ticket_db';
COMMENT ON COLUMN listings.seller_id IS 'ref:identity_db';
COMMENT ON COLUMN listings.event_id IS 'ref:event_db';
COMMENT ON COLUMN price_cap_rules.event_id IS 'ref:event_db';
