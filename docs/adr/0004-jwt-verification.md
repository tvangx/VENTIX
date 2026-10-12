# ADR-0004: Verify JWT trong từng service bằng auth-guard dùng chung

- **Trạng thái:** Đề xuất (chốt tại workshop T-107, tuần 1)
- **Ngày:** 2026-10-12
- **Người quyết định:** Tuấn, Sơn, Vũ

## Bối cảnh

identity-service ký JWT RS256 và công bố JWKS. Kong OSS (DB-less) chỉ hỗ trợ plugin jwt với public key cấu hình tĩnh theo consumer, không tự lấy/xoay JWKS (tính năng này thuộc bản Enterprise).

## Quyết định

Mỗi service dùng `auth-guard` dùng chung (thư viện jose) lấy JWKS từ identity-service, cache + làm mới khi gặp `kid` lạ. Kong chỉ làm routing, CORS, rate limit, request-id. Admission token của Waiting Room cũng kiểm tra trong booking-service.

## Phương án đã cân nhắc

- Kong jwt plugin với public key tĩnh (đơn giản, nhưng xoay khóa phải deploy lại Kong).
- Kong Enterprise/openid-connect (ngoài phạm vi).

## Hệ quả

- (+) Xoay khóa không cần động tới Kong; mỗi service tự bảo vệ (defense in depth).
- (-) Mọi service phải dùng đúng thư viện chung; request vẫn tới service trước khi bị từ chối (rate limit ở Kong giảm tải).
