-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "created_xid" TEXT NOT NULL DEFAULT pg_current_xact_id()::text,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "txn_id" UUID NOT NULL,
    "account" TEXT NOT NULL,
    "debit_vnd" BIGINT NOT NULL DEFAULT 0,
    "credit_vnd" BIGINT NOT NULL DEFAULT 0,
    "ref_type" TEXT NOT NULL,
    "ref_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events_ref" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL,
    "seat_map_version" INTEGER NOT NULL DEFAULT 0,
    "pricing_ready" BOOLEAN NOT NULL DEFAULT false,
    "ticket_classes" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "events_ref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_classes" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "ticket_class_id" UUID NOT NULL,
    "seat_map_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_orders" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_records" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "gross_vnd" BIGINT NOT NULL,
    "net_vnd" BIGINT NOT NULL,
    "vat_rate" DECIMAL(5,4) NOT NULL,
    "vat_vnd" BIGINT NOT NULL,
    "items" JSONB NOT NULL,
    "reversed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "revenue_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_refunds" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "message" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_sales_stats" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ticket_class_id" UUID NOT NULL,
    "sold" INTEGER NOT NULL,
    "revenue_vnd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_sales_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_revenue_stats" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "gross_vnd" BIGINT NOT NULL,
    "net_vnd" BIGINT NOT NULL,
    "vat_vnd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "event_revenue_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "message_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "before_state" JSONB,
    "after_state" JSONB,
    "record" JSONB NOT NULL,
    "prev_hash" CHAR(64) NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dead_letters" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "partition" INTEGER NOT NULL,
    "offset" TEXT NOT NULL,
    "original_topic" TEXT NOT NULL,
    "message_id" TEXT,
    "message_key" TEXT,
    "payload" TEXT,
    "headers" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dlq_replays" (
    "id" UUID NOT NULL,
    "dead_letter_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dlq_replays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "invoice_no" TEXT,
    "status" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "vat_rate" DECIMAL(5,4) NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "message_key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "message_id" UUID NOT NULL,
    "consumer" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("message_id","consumer")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_order_id_kind_key" ON "ledger_transactions"("order_id", "kind");

-- CreateIndex
CREATE INDEX "ledger_entries_txn_id_idx" ON "ledger_entries"("txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_ref_event_id_key" ON "events_ref"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "seat_classes_event_id_seat_id_seat_map_version_key" ON "seat_classes"("event_id", "seat_id", "seat_map_version");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_records_order_id_category_key" ON "revenue_records"("order_id", "category");

-- CreateIndex
CREATE INDEX "pending_refunds_order_id_idx" ON "pending_refunds"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_sales_stats_event_id_ticket_class_id_key" ON "event_sales_stats"("event_id", "ticket_class_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_revenue_stats_event_id_category_key" ON "event_revenue_stats"("event_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_message_id_key" ON "audit_logs"("message_id");

-- CreateIndex
CREATE UNIQUE INDEX "dead_letters_topic_partition_offset_key" ON "dead_letters"("topic", "partition", "offset");

-- CreateIndex
CREATE UNIQUE INDEX "dlq_replays_dead_letter_id_key" ON "dlq_replays"("dead_letter_id");

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- T-402: handwritten CHECK constraints and deferred append-only triggers.
ALTER TABLE ledger_transactions ADD CONSTRAINT ledger_kind CHECK (kind IN ('SALE','REFUND'));
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_account CHECK (account IN
 ('PROVIDER_RECEIVABLE','REVENUE_TICKET','REVENUE_MERCH','VAT_PAYABLE_TICKET','VAT_PAYABLE_MERCH')),
 ADD CONSTRAINT ledger_amounts CHECK (debit_vnd>=0 AND credit_vnd>=0 AND (debit_vnd=0 OR credit_vnd=0)),
 ADD CONSTRAINT ledger_txn_fk FOREIGN KEY(txn_id) REFERENCES ledger_transactions(id) ON DELETE RESTRICT;
ALTER TABLE revenue_records ADD CONSTRAINT revenue_amounts CHECK
 (gross_vnd>=0 AND net_vnd>=0 AND vat_vnd>=0 AND gross_vnd=net_vnd+vat_vnd AND vat_rate>=0 AND vat_rate<=1),
 ADD CONSTRAINT revenue_category CHECK(category IN ('TICKET','MERCH'));
ALTER TABLE event_sales_stats ADD CONSTRAINT sales_nonnegative CHECK(sold>=0 AND revenue_vnd>=0);
ALTER TABLE event_revenue_stats ADD CONSTRAINT stats_amounts CHECK
 (gross_vnd>=0 AND net_vnd>=0 AND vat_vnd>=0 AND gross_vnd=net_vnd+vat_vnd);
ALTER TABLE dead_letters ADD CONSTRAINT dlq_status CHECK(status IN ('PENDING','REPLAY_PENDING','REPLAYED','DISCARDED'));
CREATE INDEX ix_outbox_unpublished ON outbox_events(created_at) WHERE published_at IS NULL;

CREATE FUNCTION finance_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only table: %', TG_TABLE_NAME; END $$;
CREATE TRIGGER ledger_append_only BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION finance_append_only();
CREATE TRIGGER ledger_no_truncate BEFORE TRUNCATE ON ledger_entries FOR EACH STATEMENT EXECUTE FUNCTION finance_append_only();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION finance_append_only();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION finance_append_only();

-- Entries can only be inserted by the transaction which created the header.
CREATE FUNCTION finance_guard_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE origin text;
BEGIN
 SELECT created_xid INTO origin FROM ledger_transactions WHERE id=NEW.txn_id;
 IF origin IS DISTINCT FROM pg_current_xact_id()::text THEN RAISE EXCEPTION 'ledger transaction is sealed or missing'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_guard BEFORE INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION finance_guard_entry();

-- Check both header and entries at COMMIT; empty groups also fail.
CREATE FUNCTION finance_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; difference numeric; count_entries bigint;
BEGIN
 target := (to_jsonb(NEW)->>(CASE WHEN TG_TABLE_NAME='ledger_transactions' THEN 'id' ELSE 'txn_id' END))::uuid;
 SELECT count(*),COALESCE(sum(debit_vnd-credit_vnd),0) INTO count_entries,difference FROM ledger_entries WHERE txn_id=target;
 IF count_entries=0 OR difference<>0 THEN RAISE EXCEPTION 'unbalanced ledger transaction %',target; END IF;

 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION finance_balance();
CREATE CONSTRAINT TRIGGER ledger_header_balanced AFTER INSERT ON ledger_transactions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION finance_balance();
REVOKE UPDATE,DELETE,TRUNCATE ON ledger_entries,audit_logs FROM finance_user;
REVOKE EXECUTE ON FUNCTION finance_balance() FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION finance_guard_entry() FROM PUBLIC;

-- Header immutable; only the creating PostgreSQL transaction can append entries.
CREATE FUNCTION finance_stamp_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.created_xid := pg_current_xact_id()::text; RETURN NEW; END $$;
CREATE TRIGGER ledger_stamp BEFORE INSERT ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION finance_stamp_transaction();
CREATE TRIGGER ledger_header_append_only BEFORE UPDATE OR DELETE ON ledger_transactions FOR EACH ROW EXECUTE FUNCTION finance_append_only();
CREATE TRIGGER ledger_header_no_truncate BEFORE TRUNCATE ON ledger_transactions FOR EACH STATEMENT EXECUTE FUNCTION finance_append_only();
