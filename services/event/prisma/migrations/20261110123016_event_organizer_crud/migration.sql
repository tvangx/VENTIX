BEGIN;

-- Khóa hai bảng trước khi suy ra tenant từ dữ liệu S-107.
LOCK TABLE "venues", "events" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "venues" ADD COLUMN "organizer_id" UUID;

UPDATE "venues" AS venue
SET "organizer_id" = owners.organizer_id
FROM (
    SELECT "venue_id", (array_agg(DISTINCT "organizer_id"))[1] AS organizer_id
    FROM "events"
    GROUP BY "venue_id"
    HAVING count(DISTINCT "organizer_id") = 1
) AS owners
WHERE venue."id" = owners."venue_id";

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "venues" WHERE "organizer_id" IS NULL) THEN
        RAISE EXCEPTION 'Venue ownership is ambiguous. Review venues without events or shared by organizers before retrying the migration.';
    END IF;
END $$;

ALTER TABLE "venues" ALTER COLUMN "organizer_id" SET NOT NULL;
CREATE UNIQUE INDEX "venues_id_organizer_id_key" ON "venues"("id", "organizer_id");
ALTER TABLE "events" DROP CONSTRAINT "events_venue_id_fkey";
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_organizer_id_fkey"
    FOREIGN KEY ("venue_id", "organizer_id") REFERENCES "venues"("id", "organizer_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "events_organizer_id_idx";
CREATE INDEX "events_organizer_id_id_idx" ON "events"("organizer_id", "id");
CREATE INDEX "events_venue_id_organizer_id_idx" ON "events"("venue_id", "organizer_id");
CREATE INDEX "sale_phases_event_id_id_idx" ON "sale_phases"("event_id", "id");
CREATE INDEX "venues_organizer_id_id_idx" ON "venues"("organizer_id", "id");

CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "idempotency_keys_organizer_id_key_key" ON "idempotency_keys"("organizer_id", "key");

COMMIT;
