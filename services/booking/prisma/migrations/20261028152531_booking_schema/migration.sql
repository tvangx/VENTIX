-- T-201: migration mới, chỉnh tay sau prisma migrate dev --create-only.
BEGIN;

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "status" VARCHAR NOT NULL,
    "ticket_amount_vnd" BIGINT NOT NULL,
    "merch_amount_vnd" BIGINT NOT NULL,
    "total_amount_vnd" BIGINT NOT NULL,
    "idempotency_key" VARCHAR NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "item_type" VARCHAR NOT NULL,
    "ref_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_vnd" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_allocations" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "state" VARCHAR NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seat_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_class_stock" (
    "class_id" UUID NOT NULL,
    "total" INTEGER NOT NULL,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ticket_class_stock_pkey" PRIMARY KEY ("class_id")
);

-- CreateTable
CREATE TABLE "event_snapshots" (
    "event_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "status" VARCHAR NOT NULL,
    "event_version" INTEGER NOT NULL,
    "seat_map_version" INTEGER NOT NULL,
    "pricing_ready" BOOLEAN NOT NULL DEFAULT false,
    "ticket_classes" JSONB NOT NULL,
    "sale_window" JSONB NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_snapshots_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "seat_pricing" (
    "event_id" UUID NOT NULL,
    "seat_id" UUID NOT NULL,
    "seat_map_version" INTEGER NOT NULL,
    "ticket_class_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seat_pricing_pkey" PRIMARY KEY ("event_id","seat_id")
);

-- CreateTable
CREATE TABLE "vouchers" (
    "id" UUID NOT NULL,
    "code" VARCHAR NOT NULL,
    "discount_pct" INTEGER NOT NULL,
    "max_uses" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_redemptions" (
    "voucher_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_redemptions_pkey" PRIMARY KEY ("voucher_id","order_id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" VARCHAR NOT NULL,
    "user_id" UUID NOT NULL,
    "request_hash" VARCHAR NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_orders_idempotency_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "ix_order_items_order" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "ix_seat_allocations_order" ON "seat_allocations"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_vouchers_code" ON "vouchers"("code");

-- CreateIndex
CREATE INDEX "ix_voucher_redemptions_order" ON "voucher_redemptions"("order_id");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_allocations" ADD CONSTRAINT "seat_allocations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucher_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Nguyên khối SQL bắt buộc từ TUAN_PLAN.md mục T-201.
CREATE UNIQUE INDEX uq_seat_active ON seat_allocations (event_id, seat_id) WHERE state IN ('HELD','SOLD');
ALTER TABLE seat_allocations ADD CONSTRAINT ck_seat_alloc_state CHECK (state IN ('HELD','SOLD','RELEASED'));
ALTER TABLE orders ADD CONSTRAINT ck_orders_status CHECK (status IN ('PENDING','AWAITING_PAYMENT','CONFIRMED','EXPIRED','FAILED','CANCELLED','REFUND_REQUIRED','REFUNDED'));
ALTER TABLE order_items ADD CONSTRAINT ck_order_items_type CHECK (item_type IN ('TICKET_SEAT','TICKET_GA','MERCH'));
CREATE INDEX ix_orders_expiry ON orders (expires_at) WHERE status IN ('PENDING','AWAITING_PAYMENT');
CREATE INDEX ix_orders_user ON orders (user_id, created_at DESC);
CREATE INDEX ix_seat_pricing_version ON seat_pricing (event_id, seat_map_version);
ALTER TABLE ticket_class_stock ADD CONSTRAINT ck_stock_range CHECK (sold >= 0 AND sold <= total);

-- Dùng cho MỌI service: chạy trong migration của từng DB (mỗi DB có bản riêng).
CREATE TABLE IF NOT EXISTS outbox_events (
  id             uuid PRIMARY KEY,
  topic          text        NOT NULL,
  message_key    text        NOT NULL,           -- key partition Kafka
  event_type     text        NOT NULL,
  payload        jsonb       NOT NULL,           -- envelope đầy đủ
  created_at     timestamptz NOT NULL DEFAULT now(),
  published_at   timestamptz
);
CREATE INDEX IF NOT EXISTS ix_outbox_unpublished
  ON outbox_events (created_at) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS processed_events (
  message_id    uuid        NOT NULL,
  consumer      text        NOT NULL,            -- tên consumer group/handler
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, consumer)
);

COMMIT;
