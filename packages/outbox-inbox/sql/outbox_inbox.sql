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

-- Relay (polling):
--   SELECT * FROM outbox_events WHERE published_at IS NULL
--   ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 100;
--   -> publish lên Kafka (acks=all, idempotent producer) -> UPDATE published_at = now()
-- Consumer:
--   BEGIN; INSERT INTO processed_events(message_id, consumer) VALUES ($1,$2) ON CONFLICT DO NOTHING;
--   nếu 0 dòng bị chèn => đã xử lý, COMMIT và bỏ qua; ngược lại xử lý nghiệp vụ trong CÙNG transaction.
