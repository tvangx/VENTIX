# ADR-0003: Kong DB-less làm API Gateway duy nhất

- **Trạng thái:** Đề xuất (chốt tại workshop T-107, tuần 1)
- **Ngày:** 2026-10-12
- **Người quyết định:** Tuấn, Sơn, Vũ

## Bối cảnh

Cần một gateway cho routing, CORS, rate limit, request-id; v1 có cả Kong lẫn Nginx.

## Quyết định

Dùng Kong DB-less (cấu hình khai báo trong `infra/kong/kong.yml`), bỏ Nginx. TLS/WAF/CDN do Cloudflare.

## Phương án đã cân nhắc

- Traefik (nhẹ, nhưng nhóm đã chọn Kong).
- Nginx thuần (thiếu plugin sẵn có).

## Hệ quả

- (+) Một điểm vào, cấu hình trong git, dễ review.
- (-) Kong OSS không tự lấy JWKS: xem ADR-0004 về cách verify JWT.
