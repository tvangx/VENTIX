-- Chỉ dùng trong DB Event kiểm thử đã xác nhận; xóa toàn bộ dữ liệu Event.
BEGIN;
DROP TABLE processed_events, outbox_events, event_approvals, seats, blocks, zones,
  seat_maps, sale_phases, ticket_classes, events, venues;
DROP FUNCTION protect_published_seat_map();
COMMIT;
