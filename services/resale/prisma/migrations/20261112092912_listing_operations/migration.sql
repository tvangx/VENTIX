-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "organizer_id" UUID;

-- CreateTable
CREATE TABLE "listing_operations" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "request_key" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "ticket_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "ask_price_vnd" BIGINT NOT NULL,
    "event_id" UUID,
    "organizer_id" UUID,
    "original_price_vnd" BIGINT,
    "max_percent" INTEGER,
    "response" JSONB,
    "failure_code" TEXT,
    "failure_status" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trace_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resale_ticket_invalidations" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resale_ticket_invalidations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_listing_operation_request" ON "listing_operations"("seller_id", "scope", "request_key");

ALTER TABLE listing_operations ADD CONSTRAINT ck_listing_operation_kind_state CHECK (
  kind IN ('CREATE','CANCEL') AND state IN ('PENDING','FROZEN','RELEASING','COMPLETED','FAILED')
  AND (kind='CREATE' OR state IN ('PENDING','COMPLETED')) AND version>0 AND attempts>=0
  AND ask_price_vnd>=0 AND (kind='CANCEL' OR ask_price_vnd<=9007199254740991)
  AND fingerprint ~ '^[0-9a-f]{64}$'
);
ALTER TABLE listing_operations ADD CONSTRAINT ck_listing_operation_completed CHECK (
  state<>'COMPLETED' OR (response IS NOT NULL AND jsonb_typeof(response)='object')
);
ALTER TABLE listing_operations ADD CONSTRAINT ck_listing_operation_failure CHECK (
  state NOT IN ('RELEASING','FAILED') OR (failure_code IS NOT NULL AND failure_status IS NOT NULL AND failure_status BETWEEN 400 AND 499)
);
ALTER TABLE listing_operations ADD CONSTRAINT ck_listing_operation_snapshot CHECK (
  kind='CANCEL' OR state NOT IN ('FROZEN','COMPLETED') OR (event_id IS NOT NULL AND original_price_vnd IS NOT NULL AND original_price_vnd>=0 AND max_percent IS NOT NULL AND max_percent BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX uq_listing_pending_ticket ON listing_operations(ticket_id) WHERE state IN ('PENDING','FROZEN','RELEASING');
CREATE INDEX idx_listing_operation_due ON listing_operations(next_attempt_at,created_at,id) WHERE state IN ('PENDING','FROZEN','RELEASING');
CREATE INDEX idx_listing_active_search ON listings(event_id,id) WHERE status='ACTIVE';
ALTER TABLE resale_ticket_invalidations ADD CONSTRAINT ck_resale_ticket_invalidation CHECK (status IN ('REVOKED','CHECKED_IN') AND version>0);
COMMENT ON COLUMN listings.organizer_id IS 'ref:identity_db, optional tenant snapshot';
COMMENT ON COLUMN listing_operations.ticket_id IS 'ref:ticket_db';
COMMENT ON COLUMN listing_operations.seller_id IS 'ref:identity_db';
COMMENT ON COLUMN listing_operations.organizer_id IS 'ref:identity_db, optional tenant snapshot';
COMMENT ON COLUMN resale_ticket_invalidations.id IS 'ref:ticket_db';
