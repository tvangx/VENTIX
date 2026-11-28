# Trạng thái task — Tuấn

Trạng thái: `Todo` · `Doing` · `In review` · `Done` · `Blocked` · `Human` (việc Tuấn tự làm).
**Agent** chỉ được đổi `Todo → Doing → In review`. **Tuấn** chuyển sang `Done` sau khi merge.

Đối chiếu task Tuấn ngày 2026-11-25 theo ủy quyền trực tiếp của Tuấn: đã xác minh GitHub `merged=true`, base `main` và merge commit cho 10 task được chuyển từ Doing/In review sang Done. T-102/T-103 bổ sung link PR đã merge. T-207 giữ In review vì phần bổ sung ở [#109](https://github.com/tvangx/VENTIX/pull/109) chưa merge; base [#47](https://github.com/tvangx/VENTIX/pull/47) đã merge. Done ghi nhận phần triển khai đã merge; các giới hạn kiểm chứng thực tế vẫn được giữ trong ghi chú/run report. Bằng chứng chi tiết: [lần chạy 3 T-207](runs/T-207.md#12-lần-chạy-3--đối-chiếu-status-theo-yêu-cầu-tuấn-2026-11-25).

Snapshot theo dõi Sơn ngày 2026-11-12 (chưa đối chiếu lại trong lượt cập nhật task Tuấn này): S-301 đã merge #70; S-302–S-404 ở #85 đang chờ reviewer dù CI xanh. S-502 đang triển khai độc lập trên main, xem [run report S-502](runs/S-502.md) và [SON_STATUS](SON_STATUS.md). S-405/S-501 chờ #82; chưa nghiệm thu G3 theo snapshot này.

| ID     | Tuần | Tên                                                                 | Phụ thuộc                  | Trạng thái | PR  | Ghi chú                                                |
| ------ | ---- | ------------------------------------------------------------------- | -------------------------- | ---------- | --- | ------------------------------------------------------ |
| T-101  | 1    | Monorepo                                                            | —                          | Done       | —   | Phase 0                                                |
| T-102  | 1    | Template NestJS service                                             | T-101                      | Done       | #31 | Đã merge #31; xem runs/T-102.md                       |
| T-301a | 1    | Chốt hợp đồng saga (event-contracts, ADR-0009/0010, OpenAPI nội bộ) | T-107                      | Done       |     | Đã cài đặt sẵn; Tuấn review + commit; không giao agent |
| T-103  | 1    | outbox-inbox                                                        | T-102                      | Done       | #35 | Đã merge #35; mã lõi outbox/inbox                      |
| T-104  | 1    | Hạ tầng compose                                                     | T-101                      | Done       | —   | Phase 0 (đã vá Git Bash)                               |
| T-105  | 1    | CI GitHub Actions                                                   | T-102                      | Done       |     | Chưa chạy trên GitHub                                  |
| T-106  | 1    | VNPay sandbox + cloudflared + đo RAM                                | —                          | Human      |     |                                                        |
| T-107  | 1    | Workshop xác nhận hợp đồng                                          | —                          | Human      |     | Quyết định đã chốt; chỉ cần Sơn/Vũ xác nhận            |
| T-201  | 1    | Schema booking_db                                                   | T-102, T-103               | Done       | #45 | Mã lõi (unique index)                                  |
| T-207  | 1    | VPS + deploy thử                                                    | —                          | In review  | #109 | #47 đã merge; bổ sung stdin/timeout + tunnel container, xem runs/T-207.md; Tuấn nghiệm thu HTTPS |
| T-208 | Demo | Đóng gói và triển khai demo ứng dụng | Infra đã Tuấn nghiệm thu; backend Done | In review | #111 | Local artifact/checksum + 39 smoke checks; CONTRACT CHANGE đã duyệt; EC2/sandbox thật Tuấn nghiệm thu; không thay T-403/T-505/T-601; xem runs/T-208.md |
| T-202  | 2    | Lua giữ ghế + /holds                                                | T-201                      | Done       | #48 | Mã lõi; cần 2 người đọc                                |
| T-206  | 2    | Hoàn thiện Kong (+ chặn /internal)                                  | T-104, T-202               | Done       | #50 | Đã merge; Kong 3.8.0: 95 checks đạt; xem runs/T-206.md   |
| T-203  | 2    | Consumer event + rehydrate                                          | T-103, T-201, S-203        | Done  | #51 | CONTRACT CHANGE lifecycle v2; cần 2 người đọc           |
| T-204  | 2    | Seat status + SSE + sweeper                                         | T-202                      | Done       | #52 | Đã merge; H tối đa 309 ms; 126 test pass; xem runs/T-204.md |
| T-205  | 2    | k6 S1 + verify oversell                                             | T-202                      | Done       | #53 | Đã merge; verifier 0; S1 5k lỗi kết nối ở lần đo lịch sử, xem runs/T-205.md |
| T-203b | 2    | Prefetch seat_pricing                                               | T-203, S-206               | Done       | #54 | Đã merge; 104 integration test pass; xem runs/T-203b.md |
| T-301  | 3    | Checkout API                                                        | T-202, T-301a, T-203b      | Done       | #55 | Đã merge; mã lõi; xem runs/T-301.md                    |
| T-302  | 3    | payment-service + adapter                                           | T-103, T-301a              | Done       | #56 | Đã merge; E2E VNPay sandbox thật chưa được xác minh lại trong lượt này |
| T-303  | 3    | IPN idempotent + sweeper + bù trừ                                   | T-301, T-302               | Done       | #57 | Đã merge; Node 20: 240 test pass; xem runs/T-303.md     |
| T-304  | 3    | Waiting Room                                                        | T-202, T-206               | Done       | #58 | Đã merge; 232 test pass; Kong 95 checks                |
| T-401  | 4    | Refund, hoàn lô, tự hoàn tiền (LATE_PAYMENT, EventCancelled)        | T-302, T-303               | In review  | #112 | Xem runs/T-401.md; cần 2 người đọc                     |
| T-402  | 4    | finance-service (sổ cái, VAT, audit, thống kê, DLQ admin)           | T-103, T-303               | Done       | #59 | Đã merge; 32 test pass; xem runs/T-402.md              |
| T-403  | 4    | Load test vòng 1 + tối ưu                                           | G2, T-304 (T-404 nên xong) | Todo       |     | Bạn chạy k6 từ máy thứ hai                             |
| T-404  | 4    | Prometheus + Grafana                                                | T-102                      | Done       | #114 | Đã merge tại 74fb557 (#114); local pass, chờ ảnh/EC2    |
| T-405  | 4    | Payment cho đơn resale (C7)                                         | T-302, T-303, S-405        | Done       | #61 | Đã merge; 54 test pass; producer giả S-405; xem runs/T-405.md |
| T-501  | 5    | Dashboard + Loki + Jaeger                                           | T-404                      | In review  | #119, #120 | #119, #120 đã merge; PR sửa PostgreSQL exporter đa cluster trước rollout EC2 đang mở; Tuấn miễn 2 người review riêng |
| T-502  | 5    | Chaos S4 + sửa lỗi                                                  | T-403                      | Todo       |     | Bạn chạy kịch bản thật                                 |
| T-503  | 5    | Hardening                                                           | —                          | Todo       |     |                                                        |
| T-504  | 5    | Load test vòng 2 + soak                                             | T-502, T-501, T-503        | Todo       |     | Bạn chạy k6 từ máy thứ hai                             |
| T-505  | 5    | Pipeline deploy                                                     | T-207, T-403               | Todo       |     | Cổng G3; bạn tạo environments + secrets                |
| T-601  | 6    | Deploy production                                                   | T-505                      | Todo       |     |                                                        |
| T-602  | 6    | Load/chaos lần cuối                                                 | T-601                      | Todo       |     |                                                        |
| T-603  | 6    | Tài liệu                                                            | —                          | Todo       |     |                                                        |
| T-604  | 6    | Hỗ trợ + tập dượt                                                   | —                          | Todo       |     |                                                        |

## Task của Sơn/Vũ ảnh hưởng đến việc của Tuấn (theo dõi, không do agent làm)

S-201b/S-605 (ID tạm) In review tại [#103](https://github.com/tvangx/VENTIX/pull/103): upload banner presign/confirm, sharp WebP + thumbnail, `banner_url`/`thumbnail_url` catalog, CONTRACT CHANGE additive đã chốt A + A. Xem [run report](runs/S-201b.md).

S-204/V-201 In review tại [#94](https://github.com/tvangx/VENTIX/pull/94), đồng bộ main và xử lý xung đột tài liệu cho phần bổ sung catalog công khai. Xem [run report](runs/S-204.md).

S-503 In review tại [#92](https://github.com/tvangx/VENTIX/pull/92), đồng bộ main sau khi #91/#93 được tích hợp và xử lý xung đột tài liệu. Xem [run report](runs/S-503.md).

S-504 In review cho xoay khóa Identity/Ticket. Địa chỉ giao hàng chờ module lưu trữ Merch. Xem [run report](runs/S-504.md).

S-602 In review, khôi phục build Ticket sau lần tích hợp S-401/S-502. Xem [run report](runs/S-602.md).

S-603 In review tài liệu domain, xem [run report](runs/S-603.md). Lô Sơn #85/#86/#87/#88 có CI xanh tại lần đối chiếu 2026-11-13, chờ review. S-405/S-501 chờ #82, S-601 chờ xác nhận G3.

| ID    | Người | Tên                                                       | Tuấn cần khi                             |
| ----- | ----- | --------------------------------------------------------- | ---------------------------------------- |
| S-203 | Sơn   | Duyệt event + outbox `EventApproved`                      | T-203                                    |
| S-206 | Sơn   | API nội bộ `seat-classes`                                 | T-203b                                   |
| S-301 | Sơn   | Ticket consume `OrderConfirmed`                           | G2; In review, xem runs/S-301.md          |
| S-401 | Sơn   | Gate, phân công Staff, gói xác thực mã hóa có TTL         | V-401; In review, xem runs/S-401.md       |
| S-402 | Sơn   | Check-in online, unique accepted và log append-only      | In review, xem runs/S-402.md             |
| S-403 | Sơn   | Sync offline HMAC, chống trùng và delta thu hồi          | In review, xem runs/S-403.md             |
| S-404 | Sơn   | Listing create/cancel/search, freeze và recovery        | In review #81, xem runs/S-404.md         |
| V-305 | Vũ    | Merch reserve/commit theo `OrderCreated`/`OrderConfirmed` | G2                                       |
| V-306 | Vũ    | API nội bộ `quotes` (SKU lẻ)                              | T-301 (có thể dùng server giả)           |
| S-405 | Sơn   | Resale mua (+ `ResaleOrderAwaitingPayment`)               | Blocked hợp đồng refund #82, xem runs/S-405.md |
| S-605 | Sơn   | Upload ảnh banner (presign/confirm, WebP, URL công khai)  | Todo, đã chốt A + A 2026-11-24, chờ lệnh cài đặt ([spec](../specs/s-605-image-upload.md), [run](runs/S-605.md)); V-201 cần URL ảnh |
| S-505 | Sơn   | Hóa đơn (dùng bảng `invoices` của T-402)                  | G3                                       |
| V-501 | Vũ    | Admin portal (refund, audit, DLQ)                         | T-401, T-402 (DLQ: có thể dùng Kafka UI) |
| V-502 | Vũ    | Dashboard Organizer                                       | T-402 (SSE là [C], có thể polling)       |
