# Trạng thái task — Tuấn

Trạng thái: `Todo` · `Doing` · `In review` · `Done` · `Blocked` · `Human` (việc Tuấn tự làm).
**Agent** chỉ được đổi `Todo → Doing → In review`. **Tuấn** chuyển sang `Done` sau khi merge.

| ID     | Tuần | Tên                                                                 | Phụ thuộc                  | Trạng thái | PR  | Ghi chú                                                |
| ------ | ---- | ------------------------------------------------------------------- | -------------------------- | ---------- | --- | ------------------------------------------------------ |
| T-101  | 1    | Monorepo                                                            | —                          | Done       | —   | Phase 0                                                |
| T-102  | 1    | Template NestJS service                                             | T-101                      | Done       |     | Chặn Sơn/Vũ; PR chưa mở (xem runs/T-102.md)            |
| T-301a | 1    | Chốt hợp đồng saga (event-contracts, ADR-0009/0010, OpenAPI nội bộ) | T-107                      | Done       |     | Đã cài đặt sẵn; Tuấn review + commit; không giao agent |
| T-103  | 1    | outbox-inbox                                                        | T-102                      | Done       |     | Mã lõi, 2 người đọc; PR chưa mở                        |
| T-104  | 1    | Hạ tầng compose                                                     | T-101                      | Done       | —   | Phase 0 (đã vá Git Bash)                               |
| T-105  | 1    | CI GitHub Actions                                                   | T-102                      | Done       |     | Chưa chạy trên GitHub                                  |
| T-106  | 1    | VNPay sandbox + cloudflared + đo RAM                                | —                          | Human      |     |                                                        |
| T-107  | 1    | Workshop xác nhận hợp đồng                                          | —                          | Human      |     | Quyết định đã chốt; chỉ cần Sơn/Vũ xác nhận            |
| T-201  | 1    | Schema booking_db                                                   | T-102, T-103               | Done       | #45 | Mã lõi (unique index)                                  |
| T-207  | 1    | VPS + deploy thử                                                    | —                          | In review  | #47 | Agent: file prod; Tuấn: VPS/domain/secrets             |
| T-202  | 2    | Lua giữ ghế + /holds                                                | T-201                      | Done       | #48 | Mã lõi; cần 2 người đọc                                |
| T-206  | 2    | Hoàn thiện Kong (+ chặn /internal)                                  | T-104, T-202               | In review  | #50 | Kong 3.8.0: 95 checks đạt; xem runs/T-206.md              |
| T-203  | 2    | Consumer event + rehydrate                                          | T-103, T-201, S-203        | Done  | #51 | CONTRACT CHANGE lifecycle v2; cần 2 người đọc           |
| T-204  | 2    | Seat status + SSE + sweeper                                         | T-202                      | In review  | #52 | H tối đa 309 ms; 126 test pass; cần 2 người đọc Lua |
| T-205  | 2    | k6 S1 + verify oversell                                             | T-202                      | In review  | #53 | Verifier 0; S1 5k lỗi kết nối; chưa nghiệm thu G1        |
| T-203b | 2    | Prefetch seat_pricing                                               | T-203, S-206               | In review  | #54 | 104 integration test pass; cần 2 người đọc; xem runs/T-203b.md |
| T-301  | 3    | Checkout API                                                        | T-202, T-301a, T-203b      | In review  | #55 | Mã lõi                                                 |
| T-302  | 3    | payment-service + adapter                                           | T-103, T-301a              | Doing      |     | Cần VNPay sandbox                                      |
| T-303  | 3    | IPN idempotent + sweeper + bù trừ                                   | T-301, T-302               | In review  | #57 | Node 20: 240 test pass; cần 2 người đọc; xem runs/T-303.md |
| T-304  | 3    | Waiting Room                                                        | T-202, T-206               | In review  | #58 | 232 test pass; Kong 95 checks; cần 2 người đọc Lua       |
| T-401  | 4    | Refund, hoàn lô, tự hoàn tiền (LATE_PAYMENT, EventCancelled)        | T-302, T-303               | Todo       |     | Hoàn tiền = tiền thật, 2 người đọc                     |
| T-402  | 4    | finance-service (sổ cái, VAT, audit, thống kê, DLQ admin)           | T-103, T-303               | In review  | #59 | 32 test pass; cần 2 người đọc; xem runs/T-402.md          |
| T-403  | 4    | Load test vòng 1 + tối ưu                                           | G2, T-304 (T-404 nên xong) | Todo       |     | Bạn chạy k6 từ máy thứ hai                             |
| T-404  | 4    | Prometheus + Grafana                                                | T-102                      | Todo       |     |                                                        |
| T-405  | 4    | Payment cho đơn resale (C7)                                         | T-302, T-303, S-405        | In review  | #61 | 54 test pass; producer giả S-405; cần 2 người đọc; xem runs/T-405.md |
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
| S-301 | Sơn   | Ticket consume `OrderConfirmed`                           | G2; In review, xem runs/S-301.md          |
| S-401 | Sơn   | Gate, phân công Staff, gói xác thực mã hóa có TTL         | V-401; In review, xem runs/S-401.md       |
| S-402 | Sơn   | Check-in online, unique accepted và log append-only      | In review, xem runs/S-402.md             |
| V-305 | Vũ    | Merch reserve/commit theo `OrderCreated`/`OrderConfirmed` | G2                                       |
| V-306 | Vũ    | API nội bộ `quotes` (SKU lẻ)                              | T-301 (có thể dùng server giả)           |
| S-405 | Sơn   | Resale mua (+ `ResaleOrderAwaitingPayment`)               | T-405                                    |
| S-505 | Sơn   | Hóa đơn (dùng bảng `invoices` của T-402)                  | G3                                       |
| V-501 | Vũ    | Admin portal (refund, audit, DLQ)                         | T-401, T-402 (DLQ: có thể dùng Kafka UI) |
| V-502 | Vũ    | Dashboard Organizer                                       | T-402 (SSE là [C], có thể polling)       |
