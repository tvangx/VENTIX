# Identity API — bàn giao tuần 1 cho Vũ

Nguồn OpenAPI: `services/identity/openapi.json`; Swagger khi service chạy:
http://localhost:3001/docs. Export lại bằng
`pnpm --filter @ticketing/identity openapi:export`.

Base URL direct `http://localhost:3001`, gateway `http://localhost:8000/api/identity`.
Endpoint nghiệp vụ có `/v1`, JWKS là `/.well-known/jwks.json`.
OpenAPI có schemas request/response/multipart, Bearer/cookie, cursor, UUID
Idempotency-Key và lỗi `application/problem+json` với `code`/`request_id`.

## Email và cookie

1. Register với Idempotency-Key UUID cố định cho cùng thao tác; mật khẩu 12–128 ký tự.
2. Login trả access_token/900 giây và cookie HttpOnly ventix_refresh, không trả refresh token trong JSON.
3. FE đặt withCredentials=true (Axios) hoặc credentials=include (fetch) cho login/refresh/logout.
4. Giữ access token trong bộ nhớ. Refresh single-flight; refresh dùng lại token cũ thu hồi cả family.
5. Refresh trả token global: nếu đang làm việc trong tenant, gọi lại select-tenant
   để lấy token scope trước khi retry request tenant. Không gộp role giữa organizer.
6. Khi 401 từ login/refresh hoặc refresh thất bại, clear session; không tạo vòng lặp refresh.

WEB_ORIGIN mặc định http://localhost:5173. Origin khác bị từ chối ở session API.
Cookie Lax cần frontend/backend cùng site; dev dùng cùng hostname localhost,
không trộn 127.0.0.1 và localhost. Production cần HTTPS để gửi Secure cookie.

## Postman

Import `identity.postman_collection.json` và `local.postman_environment.json`.
Nhập user_password và admin_password riêng trong environment local (không commit/export
secret). Admin phải được bootstrap qua seed:admin trước. Bộ mẫu có 18 request.

Chạy nhóm 01 → 02 → Admin login/list → chọn **Approve hoặc Reject**, rồi nhóm 04.
Upload chọn file thật PDF/PNG/JPEG ≤1 MiB. Response script lưu token, organizer_id,
document_id và version. Cookie jar tự gửi/nhận refresh cookie; Admin login thay cookie
user trong cùng jar, nên login lại user trước khi thử refresh user.

Các Idempotency-Key được tạo một lần trong collection variables; muốn tạo hồ sơ mới
thì xóa application_key/document_key và các ID tương ứng. Cùng key nhưng thay body
trả 409. Không bấm cả Approve và Reject trên một hồ sơ đã xử lý.

Google start/link trong Postman dùng để xem cấu trúc. Đăng nhập thật phải bắt đầu và
callback trong **cùng trình duyệt** vì Postman không chia sẻ OAuth cookie với browser.
Google Cloud client ID/secret và redirect URI phải được cấu hình trước. Callback đặt
refresh cookie và về WEB_ORIGIN/auth/callback?provider=google; FE gọi refresh để lấy JWT.
Email trùng tài khoản cũ trả ACCOUNT_LINK_REQUIRED: login email trước rồi link.

## Sinh kiểu client

Ví dụ công cụ độc lập (không sửa apps/web trong task này):

```bash
pnpm dlx openapi-typescript@7.10.1 services/identity/openapi.json -o identity-api.d.ts
```

Vũ có thể dùng các kiểu paths/operations cùng openapi-fetch hoặc công cụ client đã
chọn cho FE. Bộ request không thay thế kiểm thử Google/MinIO thật; xem run report
về phần đã kiểm chứng và phần bị giới hạn môi trường.
