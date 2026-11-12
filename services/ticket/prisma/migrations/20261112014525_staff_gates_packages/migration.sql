-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "gate_id" UUID;

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "source_version" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gates" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_assignments" (
    "id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_requests" (
    "id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "request_key" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_gate_event" ON "gates"("id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_gate_name" ON "gates"("event_id", "name");

-- CreateIndex
CREATE INDEX "staff_assignments_staff_user_id_id_idx" ON "staff_assignments"("staff_user_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_staff_gate" ON "staff_assignments"("gate_id", "staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_ticket_request" ON "ticket_requests"("actor_id", "scope", "request_key");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_gate_id_event_id_fkey" FOREIGN KEY ("gate_id", "event_id") REFERENCES "gates"("id", "event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
CREATE UNIQUE INDEX uq_ticket_event_organizer ON ticket_events(id,organizer_id);
CREATE UNIQUE INDEX uq_gate_event_organizer ON gates(id,event_id,organizer_id);
ALTER TABLE gates ADD CONSTRAINT gates_event_id_organizer_id_fkey FOREIGN KEY (event_id,organizer_id) REFERENCES ticket_events(id,organizer_id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE staff_assignments ADD CONSTRAINT staff_assignments_gate_id_event_id_organizer_id_fkey FOREIGN KEY (gate_id,event_id,organizer_id) REFERENCES gates(id,event_id,organizer_id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE ticket_events ADD CONSTRAINT ck_ticket_event_versions CHECK (source_version >= 0 AND version > 0);
ALTER TABLE gates ADD CONSTRAINT ck_gate_valid CHECK (length(btrim(name)) > 0 AND version > 0);
ALTER TABLE staff_assignments ADD CONSTRAINT ck_staff_assignment_version CHECK (version > 0);
ALTER TABLE ticket_requests ADD CONSTRAINT ck_ticket_request_valid CHECK (fingerprint ~ '^[0-9a-f]{64}$' AND jsonb_typeof(response) = 'object');
CREATE INDEX idx_ticket_active_gate ON tickets(gate_id,id) WHERE status='ACTIVE';
