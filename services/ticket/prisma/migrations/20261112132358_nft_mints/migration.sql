-- CreateTable
CREATE TABLE "nft_mints" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "source_message_id" UUID NOT NULL,
    "trace_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_until" TIMESTAMPTZ,
    "provider" TEXT NOT NULL DEFAULT 'MOCK',
    "token_id" TEXT,
    "tx_hash" TEXT,
    "metadata_uri" TEXT,
    "mock_reference" TEXT,
    "last_error" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nft_mints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_nft_ticket" ON "nft_mints"("ticket_id");

-- AddForeignKey
ALTER TABLE "nft_mints" ADD CONSTRAINT "nft_mints_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- S-502: DB bảo vệ state/lease và không cho kết quả mock mang tx hash thật.
ALTER TABLE nft_mints
  ADD CONSTRAINT ck_nft_status CHECK (status IN ('PENDING','MINTING','MINTED','FAILED')),
  ADD CONSTRAINT ck_nft_attempts CHECK (attempts >= 0 AND version > 0),
  ADD CONSTRAINT ck_nft_lease CHECK ((status='MINTING') = (lease_until IS NOT NULL)),
  ADD CONSTRAINT ck_nft_provider CHECK (provider='MOCK' AND tx_hash IS NULL),
  ADD CONSTRAINT ck_nft_result CHECK (
    (status='MINTED' AND token_id IS NOT NULL AND metadata_uri IS NOT NULL AND mock_reference IS NOT NULL)
    OR (status<>'MINTED' AND token_id IS NULL AND metadata_uri IS NULL AND mock_reference IS NULL)
  );
CREATE INDEX ix_nft_pending ON nft_mints(next_attempt_at,id) WHERE status='PENDING';
CREATE INDEX ix_nft_lease ON nft_mints(lease_until,id) WHERE status='MINTING';
