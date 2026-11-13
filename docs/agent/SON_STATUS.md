# Trạng thái task — Sơn

## Đối chiếu lô tiếp tục — 2026-11-13

- Tuần 1–2 và S-301 đã merge main qua #36/#65/#69/#70. Các snapshot cũ bên dưới giữ làm lịch sử.
- S-302–S-305, S-401–S-404 đã triển khai trong [#85](https://github.com/tvangx/VENTIX/pull/85), CI xanh, chưa có approval, chưa merge main. Không làm lại.
- S-502 [#86](https://github.com/tvangx/VENTIX/pull/86) và S-503 [#87](https://github.com/tvangx/VENTIX/pull/87): code/test local hoàn tất, CI build/security xanh, chờ review. #87 base nhánh #86.
- S-405 chỉ có tài liệu/quyết định escrow ở #83; code và S-501 chờ hợp đồng refund resale [#82](https://github.com/tvangx/VENTIX/issues/82) đang mở. S-504 chờ S-305/#85.
- S-505: In review, nhánh `feat/finance-s505-mock-invoices` độc lập từ main, T-402 đã merge #59. 12 unit, 27 integration, 4 concurrency pass; phân vùng hóa đơn mock trong Finance, không sửa ledger/VAT/refund/schema. [Run report](runs/S-505.md).
- S-601 chờ G3, S-602 chưa có bug Sơn cụ thể đủ đầu vào; S-603 tài liệu độc lập là việc tiếp theo; S-604 cần lịch/môi trường tập dượt của team.

## Đối chiếu GitHub ngày 2026-11-11

- S-101 đã merge main qua #36; S-102–S-107 đã vào main qua #65 (`66c63b7`). Bảng tuần 1 bên dưới là snapshot lịch sử, không phải trạng thái hiện tại.
- S-201–S-206 đã merge nhánh tích hợp qua #60/#62/#64/#66/#67/#68. PR [#69](https://github.com/tvangx/VENTIX/pull/69) đưa tuần 2 lên main: build/security xanh, chưa có review, GitHub báo blocked tại thời điểm đối chiếu. Chưa merge main.
- S-301 chỉ phụ thuộc T-103/T-301a đã Done trên main, được phép bắt đầu độc lập theo bàn giao.
- Phạm vi lô còn lại theo plan: S-301–305, S-401–405, S-501–505, S-601–604. Mỗi task một nhánh/PR; kiểm tra phụ thuộc và approval trước task kế tiếp. Không làm lại tuần 1–2.

| ID    | Tuần | Tên                            | Trạng thái | Nhánh                          | Ghi chú                                                                                |
| ----- | ---- | ------------------------------ | ---------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| S-301 | 3    | Phát hành vé từ OrderConfirmed | In review  | feat/ticket-s301-issue-tickets | [Run report](runs/S-301.md); 8 unit, 15 integration, 2 concurrency pass; chờ CI/review |

PR S-301 [#70](https://github.com/tvangx/VENTIX/pull/70) đã mở ngày 2026-11-12. CI đang chạy, review còn thiếu. S-302 chờ phụ thuộc S-301 hoàn tất theo AGENTS mục 9.

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
