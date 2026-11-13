# ADR-0007: Offline check-in: staff app giữ secret mã hóa theo vé (phương án A)

- **Trạng thái:** Đề xuất (chốt tại workshop T-107, tuần 1)
- **Ngày:** 2026-10-12
- **Người quyết định:** Tuấn, Sơn, Vũ

## Bối cảnh

Verify TOTP offline cần secret của vé; danh sách hash không đủ.

## Quyết định

Staff tải gói xác thực chỉ gồm vé của đúng sự kiện + cổng, TTL ngắn, lưu IndexedDB mã hóa AES-GCM bằng khóa non-extractable (WebCrypto) dẫn xuất từ phiên + PIN; cho phép lệch ±1 bước TOTP; log offline ký HMAC; trùng giữa các cổng phát hiện khi sync.

## Phương án đã cân nhắc

- B: master key theo sự kiện (lộ master = giả mạo mọi vé).
- C: token do server ký (không đáp ứng mất mạng tại cổng).

## Hệ quả

- (+) Verify offline đầy đủ. (-) Rủi ro thiết bị bị mất; rủi ro 2 cổng offline cho cùng 1 vé vào trước khi sync (giảm bằng chia vé theo cổng, sync định kỳ).

## Đối chiếu S-603 ngày 2026-11-13

Architecture-v2 mục 6.1 và bàn giao ghi phương án A đã chốt. Dòng trạng thái Đề xuất phía trên lưu lịch sử workshop. Protocol chi tiết ADR-0015 đang chờ team review cùng PR #85. S-603 bổ sung bằng chứng triển khai và giới hạn vận hành.

S-401–S-403 trong #85 (`d4276e7`) triển khai package đúng event/cổng, RSA-OAEP SHA-256 bọc khóa AES-256-GCM, TTL mặc định 600 giây, payload secret hiện hành của vé ACTIVE. TOTP dùng SHA1, 6 số, bước 30 giây, cửa sổ ±1. Device enrollment ràng buộc public key/package/Staff và cấp HMAC key mã hóa. Sync kiểm tra chữ ký, timestamp scan trong hạn package, quyền hiện hành và version secret. Batch replay trả receipt ổn định cùng delta thu hồi mới.

Server đối soát bằng transaction và unique ACCEPTED/ticket. Nhiều thiết bị mất mạng có thể cho cùng vé qua cổng trước sync. Thu hồi assignment chặn request tiếp theo tới server, thiết bị offline nhận thu hồi sau kết nối hoặc hết TTL. Khóa non-extractable hạn chế xuất khóa qua API trình duyệt, thiết bị/session bị chiếm vẫn cần kiểm soát vận hành.

PIN, IndexedDB, xóa khóa, hiệu chỉnh đồng hồ và hiển thị conflict cần kiểm chứng phối hợp Vũ. Integration/concurrency backend trong #85 bao phủ crypto/HTTP/PostgreSQL, kết quả tại run report S-401/S-402/S-403 của PR. G3, staging/device E2E và retention/cleanup trước production còn chờ team. Xem [SRS/UC](../specs/son-domain-srs-uc.md), [ERD](../erd/son-domain-s603.md) và [sequence](../sequence/son-domain-s603.md).
