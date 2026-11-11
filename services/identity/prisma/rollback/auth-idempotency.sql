-- Rollback S-102 trước S-101, chỉ trên DB kiểm thử đã được xác nhận.
DROP TABLE idempotency_keys;
