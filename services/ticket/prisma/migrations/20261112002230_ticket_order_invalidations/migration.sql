-- CreateTable
CREATE TABLE "ticket_order_invalidations" (
    "order_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "event_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ticket_order_invalidations_pkey" PRIMARY KEY ("order_id")
);

ALTER TABLE ticket_order_invalidations ADD CONSTRAINT ck_ticket_invalidation_status
  CHECK (status IN ('REVOKED','REFUNDED') AND version > 0);
COMMENT ON COLUMN ticket_order_invalidations.order_id IS 'ref:booking_db';
COMMENT ON COLUMN ticket_order_invalidations.event_id IS 'ref:event_db; nullable for early RefundCompleted';
