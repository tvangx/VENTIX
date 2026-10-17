# Trạng thái task — Tuấn

Trạng thái: `Todo` · `Doing` · `In review` · `Done` · `Blocked` · `Human` (việc Tuấn tự làm).
**Agent** chỉ được đổi `Todo → Doing → In review`. **Tuấn** chuyển sang `Done` sau khi merge.

| ID     | Tuần | Tên                                                                 | Phụ thuộc                  | Trạng thái | PR  | Ghi chú                                                |
| ------ | ---- | ------------------------------------------------------------------- | -------------------------- | ---------- | --- | ------------------------------------------------------ |
| T-101  | 1    | Monorepo                                                            | —                          | Done       | —   | Phase 0                                                |
| T-102  | 1    | Template NestJS service                                             | T-101                      | In review  |     | Chặn Sơn/Vũ; PR chưa mở (xem runs/T-102.md)            |
| T-301a | 1    | Chốt hợp đồng saga (event-contracts, ADR-0009/0010, OpenAPI nội bộ) | T-107                      | In review  |     | Đã cài đặt sẵn; Tuấn review + commit; không giao agent |
| T-103  | 1    | outbox-inbox                                                        | T-102                      | Todo       |     | Mã lõi, 2 người đọc                                    |
| T-104  | 1    | Hạ tầng compose                                                     | T-101                      | Done       | —   | Phase 0 (đã vá Git Bash)                               |
| T-105  | 1    | CI GitHub Actions                                                   | T-102                      | In review  |     | Chưa chạy trên GitHub                                  |
| T-106  | 1    | VNPay sandbox + cloudflared + đo RAM                                | —                          | Human      |     |                                                        |
| T-107  | 1    | Workshop xác nhận hợp đồng                                          | —                          | Human      |     | Quyết định đã chốt; chỉ cần Sơn/Vũ xác nhận            |
| T-201  | 1    | Schema booking_db                                                   | T-102, T-103               | Todo       |     | Mã lõi (unique index)                                  |
| T-207  | 1    | VPS + deploy thử                                                    | —                          | Human      |     | Agent viết file prod                                   |
| T-202  | 2    | Lua giữ ghế + /holds                                                | T-201                      | Todo       |     | Mã lõi                                                 |
| T-206  | 2    | Hoàn thiện Kong (+ chặn /internal)                                  | T-104, T-202               | Todo       |     |                                                        |
| T-203  | 2    | Consumer event + rehydrate                                          | T-103, T-201, S-203        | Todo       |     |                                                        |
| T-204  | 2    | Seat status + SSE + sweeper                                         | T-202                      | Todo       |     |                                                        |
| T-205  | 2    | k6 S1 + verify oversell                                             | T-202                      | Todo       |     | Cổng G1                                                |
| T-203b | 2    | Prefetch seat_pricing                                               | T-203, S-206               | Todo       |     | Chờ Sơn S-206 (hoặc dùng server giả)                   |
| T-301  | 3    | Checkout API                                                        | T-202, T-301a, T-203b      | Todo       |     | Mã lõi                                                 |
| T-302  | 3    | payment-service + adapter                                           | T-103, T-301a              | Todo       |     | Cần VNPay sandbox                                      |
| T-303  | 3    | IPN idempotent + sweeper + bù trừ                                   | T-301, T-302               | Todo       |     | Mã lõi                                                 |
| T-304  | 3    | Waiting Room                                                        | T-202, T-206               | Todo       |     | Cuối tuần 3, được trượt sang T4                        |
| T-401  | 4    | Refund, hoàn lô, tự hoàn tiền (LATE_PAYMENT, EventCancelled)        | T-302, T-303               | Todo       |     | Hoàn tiền = tiền thật, 2 người đọc                     |
| T-402  | 4    | finance-service (sổ cái, VAT, audit, thống kê, DLQ admin)           | T-103, T-303               | Todo       |     | Consume OrderConfirmed; 2 người đọc                    |
| T-403  | 4    | Load test vòng 1 + tối ưu                                           | G2, T-304 (T-404 nên xong) | Todo       |     | Bạn chạy k6 từ máy thứ hai                             |
| T-404  | 4    | Prometheus + Grafana                                                | T-102                      | Todo       |     |                                                        |
| T-405  | 4    | Payment cho đơn resale (C7)                                         | T-302, T-303, S-405        | Todo       |     | Chờ Sơn hoặc dùng server giả                           |
| T-501  | 5    | Dashboard + Loki + Jaeger                                           | T-404                      | Todo       |     |                                                        |
| T-502  | 5    | Chaos S4 + sửa lỗi                                                  | T-403                      | Todo       |     | Bạn chạy kịch bản thật                                 |
| T-503  | 5    | Hardening                                                           | —                          | Todo       |     |                                                        |
| T-504  | 5    | Load test vòng 2 + soak                                             | T-502, T-501, T-503        | Todo       |     | Bạn chạy k6 từ máy thứ hai                             |
| T-505  | 5    | Pipeline deploy                                                     | T-207, T-403               | Todo       |     | Cổng G3; bạn tạo environments + secrets                |
| T-601  | 6    | Deploy production                                                   | T-505                      | Todo       |     |                                                        |
| T-602  | 6    | Load/chaos lần cuối                                                 | T-601                      | Todo       |     |                                                        |
| T-603  | 6    | Tài liệu                                                            | —                          | Todo       |     |                                                        |
| T-604  | 6    | Hỗ trợ + tập dượt                                                   | —                          | Todo       |     |                                                        |

## Task của Sơn/Vũ ảnh hưởng đến việc của Tuấn (theo dõi, không do agent làm)

| ID    | Người | Tên                                                       | Tuấn cần khi                             |
| ----- | ----- | --------------------------------------------------------- | ---------------------------------------- |
| S-203 | Sơn   | Duyệt event + outbox `EventApproved`                      | T-203                                    |
| S-206 | Sơn   | API nội bộ `seat-classes`                                 | T-203b                                   |
| S-301 | Sơn   | Ticket consume `OrderConfirmed`                           | G2                                       |
| V-305 | Vũ    | Merch reserve/commit theo `OrderCreated`/`OrderConfirmed` | G2                                       |
| V-306 | Vũ    | API nội bộ `quotes` (SKU lẻ)                              | T-301 (có thể dùng server giả)           |
| S-405 | Sơn   | Resale mua (+ `ResaleOrderAwaitingPayment`)               | T-405                                    |
| S-505 | Sơn   | Hóa đơn (dùng bảng `invoices` của T-402)                  | G3                                       |
| V-501 | Vũ    | Admin portal (refund, audit, DLQ)                         | T-401, T-402 (DLQ: có thể dùng Kafka UI) |
| V-502 | Vũ    | Dashboard Organizer                                       | T-402 (SSE là [C], có thể polling)       |
