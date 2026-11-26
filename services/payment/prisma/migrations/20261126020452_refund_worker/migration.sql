-- AlterTable
ALTER TABLE "refund_batches" ADD COLUMN     "automatic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "claim_token" UUID,
ADD COLUMN     "lease_until" TIMESTAMPTZ(6),
ADD COLUMN     "sent_at" TIMESTAMPTZ(6),
ADD COLUMN     "trace_id" VARCHAR NOT NULL DEFAULT 'refund';

-- CreateTable
CREATE TABLE "refund_events" (
    "id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "event_version" INTEGER NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "refund_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_dispatch" (
    "id" UUID NOT NULL,
    "next_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "refund_dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" UUID NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mock_refund_receipts" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount_vnd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mock_refund_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refund_requests_key_key" ON "refund_requests"("key");

-- CreateIndex
CREATE UNIQUE INDEX "mock_refund_receipts_payment_id_key" ON "mock_refund_receipts"("payment_id");

-- T-401: review tay SQL sau migrate --create-only. Không sửa/xóa dữ liệu hiện có.
CREATE UNIQUE INDEX uq_refund_batch_automatic ON refund_batches(event_id) WHERE automatic=true;
CREATE INDEX ix_refunds_due ON refunds(next_attempt_at,created_at,id) WHERE status='PENDING';
CREATE INDEX ix_refunds_lease ON refunds(lease_until) WHERE status='PROCESSING';
CREATE INDEX ix_payment_event_refund ON payments(event_id,id) WHERE status='SUCCEEDED' AND purpose='ORDER';
ALTER TABLE refund_events ADD CONSTRAINT ck_refund_events_version CHECK (event_version>=0 AND version>=0);
ALTER TABLE refund_dispatch ADD CONSTRAINT ck_refund_dispatch_version CHECK (version>=0);
ALTER TABLE mock_refund_receipts ADD CONSTRAINT ck_mock_refund_amount CHECK (amount_vnd>0 AND amount_vnd<=9007199254740991);
ALTER TABLE refunds ADD CONSTRAINT ck_refund_claim CHECK (
  (status='PROCESSING' AND claim_token IS NOT NULL AND lease_until IS NOT NULL AND sent_at IS NOT NULL)
  OR (status<>'PROCESSING' AND claim_token IS NULL AND lease_until IS NULL)
) NOT VALID;
-- Migration từ T-208 chưa chạy refund; nếu có PROCESSING bất thường thì cần kiểm tra tay,
-- không tự xóa dấu trạng thái để cho phép gửi thêm lệnh tiền.
ALTER TABLE refunds VALIDATE CONSTRAINT ck_refund_claim;
INSERT INTO refund_dispatch(id) VALUES('00000000-0000-4000-8000-000000000002');
