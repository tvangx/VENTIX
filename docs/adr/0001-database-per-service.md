# ADR-0001: Mỗi service một database riêng

- **Trạng thái:** Đề xuất (chốt tại workshop T-107, tuần 1)
- **Ngày:** 2026-10-12
- **Người quyết định:** Tuấn, Sơn, Vũ

## Bối cảnh

Kiến trúc v1 dùng 1 PostgreSQL với 12 schema nên các service vẫn gắn kết ở tầng dữ liệu.

## Quyết định

Mỗi service có 1 database + 1 user riêng, không FK/JOIN/view chéo DB. Dev: chung 1 PostgreSQL server nhưng tách database/user (`infra/postgres/init`). Demo/prod: tách container riêng ít nhất cho booking_db, payment_db, ticket_db.

## Phương án đã cân nhắc

- 1 DB nhiều schema (rẻ nhất, nhưng không đạt database-per-service).
- 1 server PostgreSQL cho mỗi service (đúng nhất, tốn RAM với 10 service).

## Hệ quả

- (+) Cô lập lỗi, thể hiện đúng microservices, kiểm chứng được bằng `make verify`.
- (-) Không JOIN chéo: cần read-model qua Kafka (ADR-0005) và saga (ADR-0004).
- (-) Báo cáo tổng hợp phải dựa vào finance-service/read-model.
