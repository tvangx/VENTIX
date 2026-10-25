# Trạng thái task — Sơn

Sơn giao làm theo lô S-101–S-107 ngày 2026-10-25. Mỗi task có nhánh riêng;
nhánh sau có thể dựa trên nhánh trước để kiểm thử tích hợp trước khi review.
In review chỉ có nghĩa cài đặt và kiểm thử local; Done chờ người review và merge.

| ID    | Tuần | Tên                            | Trạng thái | Nhánh                               | Ghi chú                                                          |
| ----- | ---- | ------------------------------ | ---------- | ----------------------------------- | ---------------------------------------------------------------- |
| S-101 | 1    | Schema Identity                | In review  | feat/identity-s101-schema           | Unit 4, integration 13 pass; native PostgreSQL 17                |
| S-102 | 1    | Email auth, JWT/JWKS, rotation | In review  | feat/identity-s102-auth             | Unit 5, integration 21, concurrency 1 pass                       |
| S-103 | 1    | Google OAuth PKCE              | In review  | feat/identity-s103-google-oauth     | Unit 12, integration 25 pass; chưa Google thật                   |
| S-104 | 1    | RBAC, tenant, Admin seed       | In review  | feat/identity-s104-rbac-tenant      | Integration 30 pass; role/tenant/revocation/Admin seed           |
| S-105 | 1    | Organizer, duyệt, MinIO        | In review  | feat/identity-s105-organizer        | Đã audit: Multer 2.5 + SDK S3; MinIO thật bị chặn Docker         |
| S-106 | 1    | OpenAPI + request mẫu          | In review  | docs/identity-s106-openapi-requests | Export, contract test, TypeScript generation; Postman 18 request |
| S-107 | 1    | Schema Event                   | In review  | feat/event-s107-schema              | Unit 4, integration 14 pass; FK/immutability/rollback            |

## Kiểm chứng cuối lô — 2026-10-25

- Checkout tích hợp: feat/event-s107-schema; các nhánh trước vẫn giữ riêng từng task.
- Format toàn repo pass, build 16/16 package pass; lint/typecheck/unit qua Turbo: 51/51 task pass (có cache cho phần không đổi), tổng 129 unit test.
- Identity integration 40/40; refresh concurrency 1/1 với 50 request; Event integration 14/14. Tổng 55 integration/concurrency test đã chạy lại thật trên bản tích hợp.
- DB kiểm thử: PostgreSQL 17 native, role identity_user/event_user riêng; không phải bằng chứng Testcontainers/PostgreSQL 16 hay make up/verify.
- OpenAPI export tái lập và sinh TypeScript declarations qua tsc; Postman 18 request, chưa chạy GUI Postman.
- Google thật chưa chạy vì chưa có credentials. MinIO thật chưa kiểm chứng vì test container không khởi động được (Could not find a working container runtime strategy).
- Audit prod còn đúng 29 advisory như origin/main (14 high, 13 moderate, 2 low), chênh lệch ID advisory 0. Security/CI chưa được xác nhận xanh.
- Main vẫn cf90586; chưa push, PR, review hoặc merge vào main. Done chờ quy trình review của nhóm.
