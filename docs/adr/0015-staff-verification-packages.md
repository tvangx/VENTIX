# ADR-0015 — Định dạng gói xác thực Staff

- Trạng thái đề xuất để Tuấn và Vũ review trong S-401.
- Ngày 2026-11-12. Liên quan ADR-0001, ADR-0004, ADR-0005, ADR-0007 và ADR-0011.

## Bối cảnh

Phương án A yêu cầu Staff tải secret từng vé của đúng event/cổng, có TTL. S-401 bổ sung API mới và định dạng mã hóa cho V-401.

## Thiết kế

Ticket dựng read-model event/organizer từ lifecycle hiện hành qua Inbox. Mọi bảng cổng và phân công có organizer_id, composite FK giữ đúng event/tenant. EventApproved và EventUpdated giữ phiên bản nguồn lớn nhất. Cancellation là terminal kể cả đến trước approval. Cancellation v1 có source_version sentinel 0 khi tạo tombstone, các snapshot có phiên bản tiếp theo giữ cờ cancellation.

Organizer cùng tenant và Admin quản lý cổng/phân công. Staff cần role STAFF, organizer claim phù hợp và assignment hiện hành để list/download. Thu hồi assignment và tải package khóa cùng gate row. Thu hồi đã commit chặn cả replay download.

Vé gắn lần đầu vào một cổng của event. API cho phép gắn lại cùng cổng. Khi cần chuyển cổng, chính sách phải xét package đã tải. Package gồm vé ACTIVE với secret hiện hành và chưa thu hồi. Thiếu hoặc hỏng secret trả lỗi 503.

Thiết bị gửi RSA SPKI public key 2048–4096 bit. Mỗi package sinh khóa AES 256 bit và nonce 96 bit riêng. RSA-OAEP với SHA-256 mã hóa khóa AES. AES-GCM mã hóa payload, tag 128 bit nối sau ciphertext theo định dạng WebCrypto. Các trường nhị phân dùng base64 chuẩn.

AAD là UTF-8 JSON array theo thứ tự `["ticket-verification-v1", package_id, event_id, gate_id, issued_at, expires_at]`. Client đối chiếu metadata ngoài với AAD và metadata bên trong payload sau khi giải mã, đồng thời kiểm tra event/cổng đã chọn và thời gian hết hạn.

TTL mặc định 600 giây, cấu hình 60–1800 giây. Tối đa mặc định 10.000 vé một gói, cấu hình tối đa 100.000. Gói vượt giới hạn trả PACKAGE_TOO_LARGE để quản trị chia cổng theo nhu cầu vận hành.

Mọi POST dùng UUID Idempotency-Key. Receipt lưu response đã mã hóa cùng AuditRecorded Outbox trong transaction. Replay trả response cũ sau khi kiểm tra quyền hiện hành. Package quá hạn trả PACKAGE_EXPIRED, caller dùng key mới để tải snapshot mới. Request cùng key khác nội dung trả IDEMPOTENCY_KEY_REUSED.

## Phần tích hợp PWA

V-401 giữ private key trong thiết bị, giải mã bằng WebCrypto và lưu dữ liệu vào IndexedDB mã hóa bằng khóa non-extractable dẫn xuất từ phiên và PIN theo ADR-0007. PWA kiểm tra TTL, xóa khi hết sự kiện/đăng xuất, áp dụng TOTP SHA1 6 chữ số, bước 30 giây, cửa sổ ±1. Các test S-401 kiểm tra định dạng bằng Node WebCrypto, phần IndexedDB/PIN cần kiểm thử ở V-401.

## Hệ quả

Package đã tải chịu cửa sổ offline của ADR-0007. Thiết bị đang offline chỉ biết thu hồi hoặc thay đổi secret khi nhận delta hoặc snapshot mới. Hạn dùng được thực thi bởi PWA. Receipt đã mã hóa có thể tăng theo số lần tải, chính sách lưu trữ/cleanup vận hành cần được nhóm thống nhất trước production.
