# ADR-0005: Saga + Transactional Outbox + Inbox

- **Trạng thái:** Đề xuất (chốt tại workshop T-107, tuần 1)
- **Ngày:** 2026-10-12
- **Người quyết định:** Tuấn, Sơn, Vũ

## Bối cảnh

Kafka giao at-least-once; ghi DB và publish là hai hệ thống nên có thể mất đồng bộ.

## Quyết định

Mọi thay đổi trạng thái quan trọng ghi `outbox_events` cùng transaction; relay publish lên Kafka; consumer kiểm tra `processed_events`. Checkout theo saga choreography, trạng thái order là máy trạng thái trong booking-service.

## Phương án đã cân nhắc

- Publish trực tiếp từ handler (có thể mất/ trùng).
- 2PC/XA (không phù hợp).

## Hệ quả

- (+) Không mất sự kiện, xử lý trùng an toàn.
- (-) Tăng độ trễ vài chục ms; cần thư viện dùng chung (T-103) và test kỹ.
