-- Chỉ dùng trên bản sao kiểm thử đã xác nhận. Lịch sử idempotency S-201 sẽ bị xóa.
BEGIN;

LOCK TABLE "venues", "events" IN ACCESS EXCLUSIVE MODE;
ALTER TABLE "events" DROP CONSTRAINT "events_venue_id_organizer_id_fkey";
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_fkey"
    FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX "events_organizer_id_id_idx";
CREATE INDEX "events_organizer_id_idx" ON "events"("organizer_id");
DROP INDEX "events_venue_id_organizer_id_idx";
DROP INDEX "sale_phases_event_id_id_idx";
ALTER TABLE "venues" DROP COLUMN "organizer_id";
DROP TABLE "idempotency_keys";

COMMIT;
