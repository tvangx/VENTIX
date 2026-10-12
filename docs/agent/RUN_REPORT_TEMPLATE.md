# Run report — T-xxx <tên task>

- **Ngày:** YYYY-MM-DD · **Agent/IDE:** … · **Nhánh:** `feat/...` · **PR:** …
- **Trạng thái:** Hoàn thành | Hoàn thành một phần | Bị chặn

## 1. Kiểm tra điều kiện (Bước 0)

- Phụ thuộc đã Done: …
- Spec đủ rõ? Giả định đã dùng: …
- Câu hỏi đã gửi Tuấn (nếu có) và câu trả lời: …

## 2. Kế hoạch (viết TRƯỚC khi code)

- File sẽ tạo/sửa: …
- Test sẽ viết: …
- Rủi ro / chạm vùng người khác / hợp đồng: …

## 3. Đã làm

- …

## 4. Quyết định và lệch so với spec

| Quyết định | Lý do | Tác động |
| ---------- | ----- | -------- |

## 5. Kiểm chứng (kết quả THẬT, ghi lại số liệu)

| Lệnh                              | Kết quả (pass/fail, số test) |
| --------------------------------- | ---------------------------- |
| `pnpm --filter … lint`            |                              |
| `pnpm --filter … typecheck`       |                              |
| `pnpm --filter … test`            |                              |
| `pnpm --filter … test:int`        |                              |
| `pnpm --filter … test:conc`       |                              |
| `pnpm format:check && pnpm build` |                              |

**Không chạy được / chưa kiểm chứng:** … (lý do)

## 6. Tự review (Bước 5)

- [ ] Concurrency/atomic - [ ] Idempotency - [ ] Outbox/Inbox - [ ] Bảo mật/PII - [ ] Env + `.env.example` - [ ] Log/metric - [ ] Không còn `any`/`console.log`/TODO thiếu ID

## 7. Tài liệu đã cập nhật

OpenAPI · README · ERD/sequence · ADR · STATUS.md

## 8. Thay đổi hợp đồng / thư viện mới

- Hợp đồng: không | **CONTRACT CHANGE:** …
- Thư viện mới: không | tên, lý do, giấy phép, bảo trì

## 9. Việc cần Tuấn làm / rủi ro / việc theo sau

- …

## 10. Lần chạy N (sau review)

(Thêm mục khi sửa theo góp ý: thay đổi gì, kết quả kiểm chứng lại.)
