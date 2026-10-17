---
name: core-code-review
description: Checklist review mã lõi của hệ thống bán vé. Dùng khi review hoặc tự review thay đổi liên quan Lua/Redis giữ ghế, outbox/inbox, saga và state machine, migration SQL có unique index, idempotency, hoàn tiền, mã hóa PII hoặc TOTP.
---

# Review mã lõi

Với mỗi loại thay đổi, trả lời các câu hỏi bên dưới và ghi bằng chứng (`file:dòng` hoặc tên test).

## Lua / Redis

- Kiểm tra và ghi nằm **trong cùng một script**? Thất bại giữa chừng có ghi dở không?
- Mọi key giữ chỗ có TTL? Key có hash tag `{evt:<id>}`? Có dùng `KEYS`/`SCAN` ở đường nóng không?
- Redis có bị coi là nguồn sự thật không? (Phải có bản trong PostgreSQL và đường rehydrate.)

## SQL / migration

- Ràng buộc do **DB** bảo đảm (unique, CHECK) hay chỉ bằng `if` trong code?
- Có kiểu kiểm-tra-rồi-ghi (`SELECT` rồi `INSERT`) gây race condition không?
- Migration chạy được từ DB rỗng? Có sửa migration cũ không? (Chỉ được thêm migration mới.)

## Transaction / Outbox

- Ghi nghiệp vụ và ghi `outbox_events` cùng transaction? Rollback thì không có sự kiện?
- Có `producer.send` trực tiếp trong handler nghiệp vụ không? (Cấm; chỉ qua Outbox relay.)

## Consumer / Inbox / Idempotency

- Message trùng xử lý mấy lần? Sai schema đi đâu? Xử lý và đánh dấu `processed_events` cùng transaction?
- Gọi lại cùng request cho kết quả giống nhau? Cùng key khác nội dung có bị chặn không?

## State machine

- Chuyển trạng thái có điều kiện `WHERE status=:from AND version=:v` và kiểm tra số dòng ảnh hưởng?
- Có chuyển trạng thái nằm ngoài bảng ADR-0009 không?

## Tiền, bảo mật, tenant

- Giá và số tiền do server tính, không tin client? Tiền là số nguyên VND?
- Quyền và tenant được kiểm tra? Log có lộ token/PII không? Bí mật có vào repo không?

## Test

- Có test cho đường lỗi, trùng lặp, đồng thời (≥ 50 tác vụ song song cho mã lõi)?
- Thử "phá" code (bỏ unique index, bỏ vòng kiểm tra, bỏ `ON CONFLICT`): test có chuyển đỏ không?

Kết quả trả về: danh sách phát hiện (mức độ chặn / nên sửa / nhỏ) và 3 ca test đáng bổ sung nhất.
