-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "address" VARCHAR(512) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "venue_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "banner_key" VARCHAR(512),
    "status" VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_classes" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "price_vnd" BIGINT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ticket_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_phases" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "queue_enabled" BOOLEAN NOT NULL DEFAULT false,
    "admit_rate" INTEGER NOT NULL,
    "per_user_limit" INTEGER NOT NULL,
    "require_kyc" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sale_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_maps" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "layout" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "seat_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "seat_map_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seats" (
    "id" UUID NOT NULL,
    "block_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "ticket_class_id" UUID NOT NULL,
    "row_label" VARCHAR(16) NOT NULL,
    "seat_no" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "seats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_approvals" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "admin_id" UUID NOT NULL,
    "decision" VARCHAR(24) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_approvals_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "events_organizer_id_idx" ON "events"("organizer_id");

-- CreateIndex
CREATE INDEX "events_status_start_at_id_idx" ON "events"("status", "start_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_classes_id_event_id_key" ON "ticket_classes"("id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_classes_event_id_name_key" ON "ticket_classes"("event_id", "name");

-- CreateIndex
CREATE INDEX "sale_phases_event_id_starts_at_idx" ON "sale_phases"("event_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "seat_maps_event_id_version_key" ON "seat_maps"("event_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "seat_maps_id_event_id_key" ON "seat_maps"("id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "zones_id_event_id_key" ON "zones"("id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "zones_seat_map_id_name_key" ON "zones"("seat_map_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_id_event_id_key" ON "blocks"("id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_zone_id_name_key" ON "blocks"("zone_id", "name");

-- CreateIndex
CREATE INDEX "seats_ticket_class_id_event_id_idx" ON "seats"("ticket_class_id", "event_id");

-- CreateIndex
CREATE INDEX "seats_event_id_id_idx" ON "seats"("event_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "seats_block_id_row_label_seat_no_key" ON "seats"("block_id", "row_label", "seat_no");

-- CreateIndex
CREATE INDEX "event_approvals_event_id_created_at_idx" ON "event_approvals"("event_id", "created_at");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_classes" ADD CONSTRAINT "ticket_classes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_phases" ADD CONSTRAINT "sale_phases_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_maps" ADD CONSTRAINT "seat_maps_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_seat_map_id_event_id_fkey" FOREIGN KEY ("seat_map_id", "event_id") REFERENCES "seat_maps"("id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_zone_id_event_id_fkey" FOREIGN KEY ("zone_id", "event_id") REFERENCES "zones"("id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_block_id_event_id_fkey" FOREIGN KEY ("block_id", "event_id") REFERENCES "blocks"("id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_ticket_class_id_event_id_fkey" FOREIGN KEY ("ticket_class_id", "event_id") REFERENCES "ticket_classes"("id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_approvals" ADD CONSTRAINT "event_approvals_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Các ràng buộc ngoài khả năng mô hình Prisma, bổ sung sau create-only.
ALTER TABLE venues ADD CONSTRAINT ck_venue_capacity CHECK (capacity > 0);
ALTER TABLE events ADD CONSTRAINT ck_event_times CHECK (end_at > start_at);
ALTER TABLE events ADD CONSTRAINT ck_event_status CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','PUBLISHED','ENDED','CANCELLED'));
ALTER TABLE ticket_classes ADD CONSTRAINT ck_ticket_class_values CHECK (price_vnd BETWEEN 0 AND 9007199254740991 AND capacity > 0 AND kind IN ('SEATED','GA'));
ALTER TABLE sale_phases ADD CONSTRAINT ck_sale_phase_values CHECK (ends_at > starts_at AND admit_rate > 0 AND per_user_limit > 0);
ALTER TABLE seat_maps ADD CONSTRAINT ck_seat_map_version CHECK (version > 0);
ALTER TABLE seats ADD CONSTRAINT ck_seat_position CHECK (seat_no > 0 AND length(btrim(row_label)) > 0);
ALTER TABLE event_approvals ADD CONSTRAINT ck_event_approval_decision CHECK (decision IN ('APPROVED','REJECTED'));
CREATE INDEX ix_outbox_unpublished ON outbox_events (created_at) WHERE published_at IS NULL;

-- Serialize layout writes/publish theo event để không có khoảng hở kiểm-tra-rồi-ghi.
CREATE FUNCTION protect_published_seat_map() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous jsonb; incoming jsonb; event_key text; locked boolean := false;
BEGIN
  previous := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  incoming := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  IF TG_OP = 'UPDATE' AND previous->>'event_id' <> incoming->>'event_id' THEN
    RAISE EXCEPTION 'Seat hierarchy cannot move between events' USING ERRCODE = '23514';
  END IF;
  event_key := COALESCE(incoming->>'event_id', previous->>'event_id');
  PERFORM pg_advisory_xact_lock(hashtextextended('seatmap:' || event_key, 0));
  IF TG_TABLE_NAME = 'seat_maps' THEN
    locked := previous->>'published_at' IS NOT NULL;
  ELSIF TG_TABLE_NAME = 'zones' THEN
    SELECT EXISTS(SELECT 1 FROM seat_maps m WHERE m.published_at IS NOT NULL
      AND m.id IN ((previous->>'seat_map_id')::uuid, (incoming->>'seat_map_id')::uuid)) INTO locked;
  ELSIF TG_TABLE_NAME = 'blocks' THEN
    SELECT EXISTS(SELECT 1 FROM seat_maps m JOIN zones z ON z.seat_map_id = m.id
      WHERE m.published_at IS NOT NULL AND z.id IN ((previous->>'zone_id')::uuid, (incoming->>'zone_id')::uuid)) INTO locked;
  ELSIF TG_TABLE_NAME = 'seats' THEN
    SELECT EXISTS(SELECT 1 FROM seat_maps m JOIN zones z ON z.seat_map_id=m.id JOIN blocks b ON b.zone_id=z.id
      WHERE m.published_at IS NOT NULL AND b.id IN ((previous->>'block_id')::uuid, (incoming->>'block_id')::uuid)) INTO locked;
  END IF;
  IF locked THEN RAISE EXCEPTION 'Published seat map is immutable' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_seat_map_immutable BEFORE INSERT OR UPDATE OR DELETE ON seat_maps FOR EACH ROW EXECUTE FUNCTION protect_published_seat_map();
CREATE TRIGGER trg_zone_immutable BEFORE INSERT OR UPDATE OR DELETE ON zones FOR EACH ROW EXECUTE FUNCTION protect_published_seat_map();
CREATE TRIGGER trg_block_immutable BEFORE INSERT OR UPDATE OR DELETE ON blocks FOR EACH ROW EXECUTE FUNCTION protect_published_seat_map();
CREATE TRIGGER trg_seat_immutable BEFORE INSERT OR UPDATE OR DELETE ON seats FOR EACH ROW EXECUTE FUNCTION protect_published_seat_map();
