BEGIN;

-- CreateTable
CREATE TABLE "order_saga_work" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_saga_work_pkey" PRIMARY KEY ("id"),
    -- T-303: chỉ có ba loại công việc; không có tham chiếu DB ngoài booking.
    CONSTRAINT "ck_order_saga_work_kind" CHECK ("kind" IN ('PAYMENT','SELL','RELEASE')),
    CONSTRAINT "ck_order_saga_work_payload" CHECK (jsonb_typeof("payload") = 'object')
);

-- CreateIndex
CREATE INDEX "ix_order_saga_work_order" ON "order_saga_work"("order_id");

-- Quét order hết hạn không cần đọc các order đã kết thúc.
CREATE INDEX "ix_orders_expiry_active" ON "orders"("expires_at", "id")
WHERE "status" IN ('PENDING','AWAITING_PAYMENT');

COMMIT;
