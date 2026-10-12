# ADR-0006: Booking dùng read-model (event_snapshots), không gọi sync sang event-service

- **Trạng thái:** Đề xuất (chốt tại workshop T-107, tuần 1)
- **Ngày:** 2026-10-12
- **Người quyết định:** Tuấn, Sơn, Vũ

## Bối cảnh

Đường đặt vé nóng không nên phụ thuộc runtime vào service khác.

## Quyết định

booking-service giữ `event_snapshots` đồng bộ từ topic event.lifecycle; mọi kiểm tra giá/trạng thái bán đọc từ snapshot.

## Phương án đã cân nhắc

- Gọi REST sang event-service mỗi lần (đơn giản, nhưng một điểm lỗi trên đường nóng).

## Hệ quả

- (+) Cô lập lỗi, nhanh. (-) Dữ liệu có độ trễ nhỏ; cần xử lý sự kiện tới trễ/đảo thứ tự bằng `event_version`.

> **Ngoại lệ có kiểm soát:** xem ADR-0010 (prefetch `seat_pricing` và báo giá merch đồng bộ chỉ khi order có merch).
