-- CreateTable
-- State/cookie chỉ lưu SHA-256, không lưu code_verifier hay authorization code.
CREATE TABLE "google_oauth_states" (
    "id" UUID NOT NULL,
    "state_hash" VARCHAR(64) NOT NULL,
    "cookie_hash" VARCHAR(64) NOT NULL,
    "link_user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_oauth_states_state_hash_key" ON "google_oauth_states"("state_hash");

-- CreateIndex
CREATE INDEX "google_oauth_states_expires_at_idx" ON "google_oauth_states"("expires_at");

-- AddForeignKey
ALTER TABLE "google_oauth_states" ADD CONSTRAINT "google_oauth_states_link_user_id_fkey" FOREIGN KEY ("link_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
