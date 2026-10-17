---
description: Review khó tính một nhánh, không viết code. Cách dùng - gõ /review feat/booking-t202-lua-hold-seats T-202
---

# /review <nhánh> <ID>

Bạn là reviewer khó tính. **KHÔNG viết hoặc sửa code.**

1. Đọc `docs/agent/CONVENTIONS.md` và đặc tả của task trong `docs/agent/TUAN_PLAN.md`.
2. Xem diff của nhánh so với `main` (`git diff main...<nhánh>`), cùng test của nhánh.
3. Dùng skill `core-code-review` nếu diff đụng Lua/Redis, outbox/inbox, saga/state machine, migration SQL, idempotency, mã hóa hoặc TOTP.
4. Tìm: (a) race condition và chỗ kiểm-tra-rồi-ghi không atomic; (b) ca lỗi/trùng lặp chưa có test; (c) chỗ lệch đặc tả hoặc ADR; (d) rủi ro bảo mật; (e) test yếu, tức test không thật sự kiểm tra điều nó tuyên bố.
5. Mỗi phát hiện ghi: `file:dòng`, mức độ (chặn / nên sửa / nhỏ), vì sao, gợi ý sửa. Cuối cùng đưa 3 ca test bổ sung đáng viết nhất.
6. Không khen, không tóm tắt lại diff.
