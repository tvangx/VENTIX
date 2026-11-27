-- Additive OTel W3C carrier only; old relays ignore this nullable metadata.
ALTER TABLE outbox_events ADD COLUMN trace_context jsonb;
