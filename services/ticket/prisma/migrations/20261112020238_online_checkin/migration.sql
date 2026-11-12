-- CreateTable
CREATE TABLE "checkin_logs" (
    "id" UUID NOT NULL,
    "ticket_id" UUID,
    "scanned_ticket_id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "organizer_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "result" TEXT NOT NULL,
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "scanned_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkin_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checkin_logs_gate_id_id_idx" ON "checkin_logs"("gate_id", "id");

-- AddForeignKey
ALTER TABLE "checkin_logs" ADD CONSTRAINT "checkin_logs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkin_logs" ADD CONSTRAINT "checkin_logs_gate_id_event_id_organizer_id_fkey" FOREIGN KEY ("gate_id", "event_id", "organizer_id") REFERENCES "gates"("id", "event_id", "organizer_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX uq_checkin_accepted ON checkin_logs(ticket_id) WHERE result='ACCEPTED';
ALTER TABLE checkin_logs ADD CONSTRAINT ck_checkin_result CHECK (result IN ('ACCEPTED','DUPLICATE','WRONG_EVENT','WRONG_GATE','INVALID'));
ALTER TABLE checkin_logs ADD CONSTRAINT ck_checkin_ticket CHECK ((ticket_id IS NOT NULL OR result='INVALID') AND (ticket_id IS NULL OR ticket_id=scanned_ticket_id));

CREATE FUNCTION reject_checkin_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'checkin_logs is append-only' USING ERRCODE='55000';
END;
$$;
CREATE TRIGGER checkin_logs_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON checkin_logs FOR EACH STATEMENT EXECUTE FUNCTION reject_checkin_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON checkin_logs FROM ticket_user;

COMMENT ON COLUMN checkin_logs.staff_user_id IS 'ref:identity_db';
