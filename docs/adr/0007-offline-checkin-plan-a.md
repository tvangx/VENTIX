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
