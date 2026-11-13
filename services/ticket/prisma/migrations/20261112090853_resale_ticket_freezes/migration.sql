-- CreateTable
CREATE TABLE "ticket_freezes" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "organizer_id" UUID,
    "original_price_vnd" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_freezes_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ticket_freezes" ADD CONSTRAINT "ticket_freezes_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE ticket_freezes ADD CONSTRAINT ck_ticket_freeze CHECK (status IN ('FROZEN','RELEASED') AND original_price_vnd>=0 AND version>0);
CREATE UNIQUE INDEX uq_ticket_frozen_listing ON ticket_freezes(ticket_id) WHERE status='FROZEN';
COMMENT ON COLUMN ticket_freezes.id IS 'ref:resale_db:listings.id, stable caller listing reference';
COMMENT ON COLUMN ticket_freezes.seller_id IS 'ref:identity_db';
COMMENT ON COLUMN ticket_freezes.event_id IS 'ref:event_db';
COMMENT ON COLUMN ticket_freezes.organizer_id IS 'ref:identity_db, optional tenant snapshot';
