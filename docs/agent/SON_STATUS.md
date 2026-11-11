# Trạng thái task — Sơn

Sơn giao làm theo lô S-101–S-107 ngày 2026-10-25. Mỗi task có nhánh riêng;
nhánh sau có thể dựa trên nhánh trước để kiểm thử tích hợp trước khi review.
In review chỉ có nghĩa cài đặt và kiểm thử local; Done chờ người review và merge.

| ID    | Tuần | Tên                            | Trạng thái | Nhánh                               | Ghi chú                                                                  |
| ----- | ---- | ------------------------------ | ---------- | ----------------------------------- | ------------------------------------------------------------------------ |
| S-101 | 1    | Schema Identity                | In review  | feat/identity-s101-schema           | Unit 4, integration 13 pass; native PostgreSQL 17                        |
| S-102 | 1    | Email auth, JWT/JWKS, rotation | In review  | feat/identity-s102-auth             | Unit 5, integration 21, concurrency 1 pass                               |
| S-103 | 1    | Google OAuth PKCE              | In review  | feat/identity-s103-google-oauth     | Unit 12, integration 25 pass; chưa Google thật                           |
| S-104 | 1    | RBAC, tenant, Admin seed       | In review  | feat/identity-s104-rbac-tenant      | Integration 30 pass; role/tenant/revocation/Admin seed                   |
| S-105 | 1    | Organizer, duyệt, MinIO        | In review  | feat/identity-s105-organizer        | Đã audit: Multer 2.5 + SDK S3; MinIO thật bị chặn Docker                 |
| S-106 | 1    | OpenAPI + request mẫu          | In review  | docs/identity-s106-openapi-requests | Export, contract test, TypeScript generation; Postman 18 request         |
| S-107 | 1    | Schema Event                   | In review  | feat/event-s107-schema              | Unit 4, integration 14 pass; FK/immutability/rollback                    |
| S-201 | 2    | CRUD Event và tenant           | Done       | feat/event-s201-implementation      | PR #60 đã merge vào nhánh tích hợp.                                      |
| S-202 | 2    | Seat map và sinh ghế           | Done       | feat/event-s202-seat-map            | PR #62 đã merge. Tạo 10.000 ghế dưới 5 giây.                             |
| S-203 | 2    | Duyệt và publish sự kiện       | Done       | feat/event-s203-lifecycle           | PR #64 đã merge. Kafka lifecycle v2, 41 test pass.                       |
| S-204 | 2    | Catalog sự kiện công khai      | Done       | feat/event-s204-public-catalog      | PR #66 đã merge. Redis, ETag và tải đọc đã kiểm chứng.                   |
| S-205 | 2    | Seed dữ liệu Event             | Done       | feat/event-s205-seed                | PR #67 đã merge. 3 sự kiện, 10.000 ghế, chạy lặp được.                   |
| S-206 | 2    | API hạng vé theo ghế           | Done       | feat/event-s206-seat-classes        | PR #68 đã merge. 10.000 ánh xạ, khóa nội bộ và Kong T-206 đã kiểm chứng. |

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
