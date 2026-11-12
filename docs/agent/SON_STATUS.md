# Trạng thái task — Sơn

## Đối chiếu khi tiếp tục ngày 2026-11-12

- Nhánh tích hợp `chore/son-s302-s404-main` được tạo từ main 0977e9d và merge chuỗi tại b98d7c8 để mở PR main. Source Event tuần 2/V-103 của main và source S-302–404 được đối chiếu sau resolve. Xem [run report tích hợp](runs/SON_S302_S404_MAIN.md).
- S-404 #81 có build/security xanh ở attempt 3 và đã merge nhánh tích hợp b98d7c8. Hai lượt CI trước timeout JWKS cũ, source/threshold giữ qua retry. PR tài liệu S-405 [#83](https://github.com/tvangx/VENTIX/pull/83) đã được merge vào base tại 7c6d577, gồm báo cáo điều kiện và chính sách escrow. Phần code S-405 đang chờ hợp đồng hoàn tiền ở #82.
- S-405 Bị chặn ở precheck hợp đồng hoàn tiền resale, đề nghị Tuấn tại Issue [#82](https://github.com/tvangx/VENTIX/issues/82) theo lựa chọn người giao việc. T-302 #56 và T-405 #61 đã merge main, source Payment có MOCK/RESALE. Chính sách giải ngân đã được xác nhận trong ADR-0017. Xem [run report S-405](runs/S-405.md).

- #69 và #70 đã merge main, origin/main hiện 0977e9d sau PR #78 của Vũ.
- #71–77 đã merge vào các base branch xếp chồng. #79 và #80 có CI xanh, đã merge thường vào nhánh S-401 tại ff8d9a1 và 6721156. Code S-302–S-403 đang ở nhánh tích hợp. Cần PR tích hợp lên main sau khi CI/review đủ.
- S-402 In review ở PR [#79](https://github.com/tvangx/VENTIX/pull/79), nhánh feat/ticket-s402-online-checkin. Source cuối gồm UUID case-insensitive có unit 19/19, integration 47/47, concurrency 7/7 pass, OpenAPI/format/build 16/16 pass. Xem [run report](runs/S-402.md).
- S-403 In review ở PR [#80](https://github.com/tvangx/VENTIX/pull/80), nhánh feat/ticket-s403-offline-sync, base S-401 chứa #79. Protocol HMAC, device key, sync/delta, unit 22/22, toàn integration 61/61, concurrency 10/10 và build 16/16 pass. Offline integration cuối 13/13 pass, Kafka offline=true đã kiểm tra thật. Xem [run report](runs/S-403.md).

## Snapshot đối chiếu GitHub ngày 2026-11-11

S-404 In review ở PR [#81](https://github.com/tvangx/VENTIX/pull/81) trên `feat/resale-s404-listings-freeze`, base tích hợp S-401 tại 6721156. Freeze đồng bộ idempotent, durable operation/recovery, tìm kiếm và Inbox/Outbox. Ticket 22 unit, 68 integration, 11 concurrency pass. Resale 9 unit, 23 integration, 4 concurrency pass. Migration/OpenAPI/format/build 16/16 pass. Lint/typecheck/unit toàn repo mỗi lệnh 20/20 task pass. Xem [run report](runs/S-404.md).

- S-101 đã merge main qua #36; S-102–S-107 đã vào main qua #65 (`66c63b7`). Bảng tuần 1 bên dưới là snapshot lịch sử, không phải trạng thái hiện tại.
- S-201–S-206 đã merge nhánh tích hợp qua #60/#62/#64/#66/#67/#68. PR [#69](https://github.com/tvangx/VENTIX/pull/69) đưa tuần 2 lên main: build/security xanh, chưa có review, GitHub báo blocked tại thời điểm đối chiếu. Chưa merge main.
- S-301 chỉ phụ thuộc T-103/T-301a đã Done trên main, được phép bắt đầu độc lập theo bàn giao.
- Phạm vi lô còn lại theo plan: S-301–305, S-401–405, S-501–505, S-601–604. Mỗi task một nhánh/PR; kiểm tra phụ thuộc và approval trước task kế tiếp. Không làm lại tuần 1–2.

| ID    | Tuần | Tên                            | Trạng thái | Nhánh                          | Ghi chú                                                                                |
| ----- | ---- | ------------------------------ | ---------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| S-301 | 3    | Phát hành vé từ OrderConfirmed | In review  | feat/ticket-s301-issue-tickets | [Run report](runs/S-301.md); 8 unit, 15 integration, 2 concurrency pass; chờ CI/review |

PR S-301 [#70](https://github.com/tvangx/VENTIX/pull/70) đã mở ngày 2026-11-12. Người dùng cho phép tiếp tục S-302 từ nhánh S-301 trong lúc chờ reviewer, mỗi task giữ nhánh và PR riêng. Các PR sẽ merge theo phụ thuộc sau khi đủ CI và review.

S-302 In review trên `feat/ticket-s302-totp-wallet`, base nhánh S-301, PR [#71](https://github.com/tvangx/VENTIX/pull/71). Unit 16/16, wallet HTTP 3/3, concurrency 2/2, lint/typecheck/build pass. Xem [run report](runs/S-302.md).

S-303 In review ở PR [#73](https://github.com/tvangx/VENTIX/pull/73) trên `feat/ticket-s303-revoke-refunded`. Theo yêu cầu tiếp tục của người dùng, hợp đồng [#72](https://github.com/tvangx/VENTIX/issues/72) được triển khai ở PR [#74](https://github.com/tvangx/VENTIX/pull/74), base #71. PR #73 đổi base sang nhánh hợp đồng. Unit 16/16, integration 27/27, concurrency 3/3 pass, contract 29/29 pass. Xem [run report](runs/S-303.md). Tuấn review version/rollout sau khi code hoàn tất.

Đối chiếu ngày 2026-11-12 cho thấy PR #70 và #71 có build/security xanh. PR #70 rerun thành công sau timeout test auth-guard ở lượt CI đầu. Các PR vẫn chờ review trước merge main.

S-304 In review ở PR [#75](https://github.com/tvangx/VENTIX/pull/75), nhánh `feat/resale-s304-schema-price-cap`, base S-303. Unit 8/8, integration 11/11 và concurrency 1/1 pass. Quote dùng giá API Ticket, luồng tạo/freeze listing thuộc S-404. Xem [run report](runs/S-304.md).

S-305 In review trên PR [#76](https://github.com/tvangx/VENTIX/pull/76), nhánh `feat/identity-s305-kyc`. Người dùng chọn email tài khoản + Mailpit local. Identity 23 unit, 49 integration và 3 concurrency pass trên source cuối, bao gồm fingerprint idempotency độc lập JWT. SMTP Mailpit và audit Kafka đã kiểm tra thật, KYC vẫn là email + thông tin tự khai. Xem [run report](runs/S-305.md).

S-401 In review trên PR [#77](https://github.com/tvangx/VENTIX/pull/77), nhánh `feat/ticket-s401-staff-packages`, base S-305 #76. Gate/Staff/package, tenant binding lifecycle, AES-GCM/RSA-OAEP tương thích WebCrypto. Ticket 19 unit, 35 integration, 5 concurrency pass, build 16/16. Xem [run report](runs/S-401.md).

## Snapshot bàn giao tuần 1 — 2026-10-25

Sơn giao làm theo lô S-101–S-107 ngày 2026-10-25. Mỗi task có nhánh riêng;
nhánh sau có thể dựa trên nhánh trước để kiểm thử tích hợp trước khi review.
In review chỉ có nghĩa cài đặt và kiểm thử local; Done chờ người review và merge.

| ID    | Tuần | Tên                            | Trạng thái | Nhánh                               | Ghi chú                                                                  |
| ----- | ---- | ------------------------------ | ---------- | ----------------------------------- | ------------------------------------------------------------------------ |
| S-101 | 1    | Schema Identity                | Done       | feat/identity-s101-schema           | Unit 4, integration 13 pass; native PostgreSQL 17                        |
| S-102 | 1    | Email auth, JWT/JWKS, rotation | Done       | feat/identity-s102-auth             | Unit 5, integration 21, concurrency 1 pass                               |
| S-103 | 1    | Google OAuth PKCE              | Done       | feat/identity-s103-google-oauth     | Unit 12, integration 25 pass; chưa Google thật                           |
| S-104 | 1    | RBAC, tenant, Admin seed       | Done       | feat/identity-s104-rbac-tenant      | Integration 30 pass; role/tenant/revocation/Admin seed                   |
| S-105 | 1    | Organizer, duyệt, MinIO        | Done       | feat/identity-s105-organizer        | Kiểm thử MinIO thật 1/1 qua trên PR #65.                                 |
| S-106 | 1    | OpenAPI + request mẫu          | Done       | docs/identity-s106-openapi-requests | Export, contract test, TypeScript generation; Postman 18 request         |
| S-107 | 1    | Schema Event                   | Done       | feat/event-s107-schema              | Unit 4, integration 14 pass; FK/immutability/rollback                    |
| S-201 | 2    | CRUD Event và tenant           | Done       | feat/event-s201-implementation      | PR #60 đã merge vào nhánh tích hợp.                                      |
| S-202 | 2    | Seat map và sinh ghế           | Done       | feat/event-s202-seat-map            | PR #62 đã merge. Tạo 10.000 ghế dưới 5 giây.                             |
| S-203 | 2    | Duyệt và publish sự kiện       | Done       | feat/event-s203-lifecycle           | PR #64 đã merge. Kafka lifecycle v2, 41 test pass.                       |
| S-204 | 2    | Catalog sự kiện công khai      | Done       | feat/event-s204-public-catalog      | PR #66 đã merge. Redis, ETag và tải đọc đã kiểm chứng.                   |
| S-205 | 2    | Seed dữ liệu Event             | Done       | feat/event-s205-seed                | PR #67 đã merge. 3 sự kiện, 10.000 ghế, chạy lặp được.                   |
| S-206 | 2    | API hạng vé theo ghế           | Done       | feat/event-s206-seat-classes        | PR #68 đã merge. 10.000 ánh xạ, khóa nội bộ và Kong T-206 đã kiểm chứng. |

S-101 vào main qua PR #36, S-102–S-107 qua PR #65. S-201–S-206 được
tích hợp theo các PR trong bảng và đưa vào main theo lô tuần 2.

## Kiểm chứng cuối lô — 2026-10-25

- Checkout tích hợp: feat/event-s107-schema; các nhánh trước vẫn giữ riêng từng task.
- Format toàn repo pass, build 16/16 package pass; lint/typecheck/unit qua Turbo: 51/51 task pass (có cache cho phần không đổi), tổng 129 unit test.
- Identity integration 40/40; refresh concurrency 1/1 với 50 request; Event integration 14/14. Tổng 55 integration/concurrency test đã chạy lại thật trên bản tích hợp.
- DB kiểm thử: PostgreSQL 17 native, role identity_user/event_user riêng; không phải bằng chứng Testcontainers/PostgreSQL 16 hay make up/verify.
- OpenAPI export tái lập và sinh TypeScript declarations qua tsc; Postman 18 request, chưa chạy GUI Postman.
- Google thật chưa chạy vì chưa có credentials. MinIO thật chưa kiểm chứng vì test container không khởi động được (Could not find a working container runtime strategy).
- Audit prod còn đúng 29 advisory như origin/main (14 high, 13 moderate, 2 low), chênh lệch ID advisory 0. Security/CI chưa được xác nhận xanh.
- Main vẫn cf90586; các kết quả kiểm chứng trên được ghi nhận trước khi push/tạo PR. Done chờ quy trình review của nhóm.

## Pull request — đã push ngày 2026-10-25

Sơn đã yêu cầu commit, push và tạo MR. Repo GitHub dùng pull request; đã push 7
nhánh và tạo từng PR riêng theo task. Các thay đổi code đã commit từ lượt triển
khai; không tạo commit rỗng. Chưa merge hoặc bật auto-merge.

| Task  | PR                                       | Base để review                      |
| ----- | ---------------------------------------- | ----------------------------------- |
| S-101 | https://github.com/tvangx/VENTIX/pull/36 | main                                |
| S-102 | https://github.com/tvangx/VENTIX/pull/37 | feat/identity-s101-schema           |
| S-103 | https://github.com/tvangx/VENTIX/pull/38 | feat/identity-s102-auth             |
| S-104 | https://github.com/tvangx/VENTIX/pull/39 | feat/identity-s103-google-oauth     |
| S-105 | https://github.com/tvangx/VENTIX/pull/40 | feat/identity-s104-rbac-tenant      |
| S-106 | https://github.com/tvangx/VENTIX/pull/41 | feat/identity-s105-organizer        |
| S-107 | https://github.com/tvangx/VENTIX/pull/42 | docs/identity-s106-openapi-requests |

Review/merge theo thứ tự và cập nhật base/đồng bộ nhánh phụ thuộc sau mỗi lần
merge. CI là kết quả riêng trên GitHub, không suy từ các test local đã pass.
