# Trạng thái task — Sơn

Sơn giao làm theo lô S-101–S-107 ngày 2026-10-25. Mỗi task có nhánh riêng;
nhánh sau có thể dựa trên nhánh trước để kiểm thử tích hợp trước khi review.
In review chỉ có nghĩa cài đặt và kiểm thử local; Done chờ người review và merge.

| ID    | Tuần | Tên                            | Trạng thái | Nhánh                           | Ghi chú                                                |
| ----- | ---- | ------------------------------ | ---------- | ------------------------------- | ------------------------------------------------------ |
| S-101 | 1    | Schema Identity                | In review  | feat/identity-s101-schema       | Unit 4, integration 13 pass; native PostgreSQL 17      |
| S-102 | 1    | Email auth, JWT/JWKS, rotation | In review  | feat/identity-s102-auth         | Unit 5, integration 21, concurrency 1 pass             |
| S-103 | 1    | Google OAuth PKCE              | In review  | feat/identity-s103-google-oauth | Unit 12, integration 25 pass; chưa Google thật         |
| S-104 | 1    | RBAC, tenant, Admin seed       | In review  | feat/identity-s104-rbac-tenant  | Integration 30 pass; role/tenant/revocation/Admin seed |
| S-105 | 1    | Organizer, duyệt, MinIO        | Todo       | —                               | Phụ thuộc S-104                                        |
| S-106 | 1    | OpenAPI + request mẫu          | Todo       | —                               | Phụ thuộc S-102                                        |
| S-107 | 1    | Schema Event                   | Todo       | —                               | Phụ thuộc T-102                                        |
