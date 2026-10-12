# ADR-0002: Chống oversell nhiều lớp: Waiting Room, Redis Lua, unique index

- **Trạng thái:** Đề xuất (chốt tại workshop T-107, tuần 1)
- **Ngày:** 2026-10-12
- **Người quyết định:** Tuấn, Sơn, Vũ

## Bối cảnh

Khóa ghế bằng SETNX từng ghế không atomic khi chọn nhiều ghế; Redis mất dữ liệu có thể làm bán trùng.

## Quyết định

Waiting Room (Redis ZSET + admission token) → giữ ghế bằng Lua all-or-nothing → partial unique index `uq_seat_active(event_id, seat_id) WHERE state IN ('HELD','SOLD')` trong booking_db làm chốt chặn cuối. Redis cấu hình `noeviction`.

## Phương án đã cân nhắc

- Chỉ Redis lock (nhanh, không an toàn khi Redis lỗi).
- Chỉ khóa hàng trong PostgreSQL (an toàn, nghẽn khi flash sale).

## Hệ quả

- (+) Oversell = 0 kể cả khi Redis restart; có kịch bản k6 + SQL kiểm chứng.
- (-) Cần job rehydrate Redis từ DB sau khi Redis khởi động lại.
