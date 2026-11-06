-- CreateTable
CREATE TABLE "payables" (
    "id" UUID NOT NULL,
    "purpose" VARCHAR NOT NULL,
    "ref_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'READY',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payables_pkey" PRIMARY KEY ("purpose","ref_id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "purpose" VARCHAR NOT NULL,
    "ref_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "provider" VARCHAR NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'PENDING',
    "idempotency_key" VARCHAR(200) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "redirect_url" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "trace_id" VARCHAR NOT NULL,
    "mock_data" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "provider_txn_id" VARCHAR NOT NULL,
    "kind" VARCHAR NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_batches" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "reason" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "refund_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "batch_id" UUID,
    "amount_vnd" BIGINT NOT NULL,
    "reason" VARCHAR NOT NULL,
    "status" VARCHAR NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6),
    "provider_refund_id" VARCHAR,
    "last_error" TEXT,
    "approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "run_at" TIMESTAMPTZ(6) NOT NULL,
    "matched" INTEGER NOT NULL,
    "mismatched" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "payables_id_key" ON "payables"("id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_provider_txn_id_key" ON "payment_transactions"("provider_txn_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_payment_id_key" ON "refunds"("payment_id");

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "refund_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- T-302: PostgreSQL bảo đảm D7 kể cả khi writer không dùng khóa ứng dụng.
CREATE UNIQUE INDEX uq_payments_active ON payments(purpose, ref_id)
  WHERE status IN ('PENDING', 'SUCCEEDED');
CREATE INDEX ix_payments_mock_pending ON payments(created_at)
  WHERE provider='MOCK' AND status='PENDING';
CREATE INDEX ix_outbox_unpublished ON outbox_events(created_at) WHERE published_at IS NULL;
ALTER TABLE payables ADD CONSTRAINT ck_payables_purpose CHECK (purpose IN ('ORDER','RESALE')),
  ADD CONSTRAINT ck_payables_amount CHECK (amount_vnd >= 0 AND amount_vnd <= 9007199254740991),
  ADD CONSTRAINT ck_payables_status CHECK (status IN ('READY','EXPIRED','CANCELLED')),
  ADD CONSTRAINT ck_payables_version CHECK (version >= 0);
ALTER TABLE payments ADD CONSTRAINT ck_payments_purpose CHECK (purpose IN ('ORDER','RESALE')),
  ADD CONSTRAINT ck_payments_provider CHECK (provider IN ('VNPAY','MOCK','MOMO')),
  ADD CONSTRAINT ck_payments_amount CHECK (amount_vnd > 0 AND amount_vnd <= 9007199254740991),
  ADD CONSTRAINT ck_payments_status CHECK (status IN ('PENDING','SUCCEEDED','FAILED','EXPIRED')),
  ADD CONSTRAINT ck_payments_version CHECK (version >= 0),
  ADD CONSTRAINT ck_payments_paid_at CHECK ((status='SUCCEEDED') = (paid_at IS NOT NULL)),
  ADD CONSTRAINT ck_payments_mock_data CHECK ((provider='MOCK') = (mock_data IS NOT NULL));
ALTER TABLE payment_transactions ADD CONSTRAINT ck_payment_transactions_kind CHECK (kind IN ('PAY','REFUND'));
ALTER TABLE refunds ADD CONSTRAINT ck_refunds_amount CHECK (amount_vnd > 0 AND amount_vnd <= 9007199254740991),
  ADD CONSTRAINT ck_refunds_status CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','NEEDS_MANUAL')),
  ADD CONSTRAINT ck_refunds_attempts CHECK (attempts >= 0),
  ADD CONSTRAINT ck_refunds_version CHECK (version >= 0);
ALTER TABLE reconciliation_runs ADD CONSTRAINT ck_reconciliation_counts CHECK (matched >= 0 AND mismatched >= 0);
