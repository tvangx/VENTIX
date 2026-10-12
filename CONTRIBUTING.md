# Quy tắc làm việc

## 1. Nhánh và commit

- `main` được bảo vệ: bắt buộc PR, CI xanh, ≥ 1 approve. **Không push thẳng `main`.**
- Nhánh: `feat/<service>-<mô-tả>`, `fix/...`, `chore/...`, `docs/...`
- Commit theo Conventional Commits (hook `commitlint` kiểm tra):
  `feat(booking): add lua hold script` · `fix(payment): ignore duplicate ipn` · `docs(adr): add 0009`
  Scope hợp lệ: repo, infra, ci, docs, contracts, outbox, identity, event, booking, payment, ticket, resale, merch, notification, finance, ai, web, staff-pwa.
- Squash merge. PR ưu tiên ≤ 400 dòng.

## 2. Công việc

- Mỗi task trong `docs/architecture/plan-6-weeks.md` là một Issue (tiêu đề bắt đầu bằng ID, ví dụ `T-203`).
- Cột bảng: `Backlog → Ready → Doing → Review → Done`. Ghi rõ nếu bị chặn (nhãn `blocked`) và báo ở stand-up.

## 3. Review

- Người review theo `.github/CODEOWNERS`.
- **Mã lõi cần 2 người đọc:** Lua script, outbox/inbox, saga, unique index, mã hóa PII, TOTP.

## 4. Định nghĩa Hoàn thành (DoD)

- [ ] CI xanh (format, lint, typecheck, build, test, Trivy)
- [ ] Có test phù hợp (unit; integration với Testcontainers khi đụng DB/Kafka/Redis)
- [ ] OpenAPI / event contract cập nhật nếu đổi giao diện
- [ ] Migration chạy từ DB rỗng và có rollback
- [ ] Log JSON có `request_id`/`trace_id`
- [ ] Chạy được với `make up` + `pnpm dev`
- [ ] Đã có approve

## 5. Hợp đồng

- Thay đổi `packages/event-contracts`: chỉ **thêm** field tùy chọn; thay đổi phá vỡ → tăng `version` và giữ schema cũ. **Tuấn duyệt.**
- Mỗi service tự quản OpenAPI của mình; đổi API đã bàn giao phải báo người dùng API trước.

## 6. Dữ liệu và bảo mật

- Không bao giờ commit `.env`, khóa, mật khẩu thật. Hook/CI sẽ chặn nếu phát hiện.
- Không truy cập DB của service khác (kể cả khi kết nối được). Cần dữ liệu → qua API hoặc sự kiện.
- Tiền là số nguyên VND. Dữ liệu định danh (CCCD, địa chỉ) mã hóa AES-256-GCM ở tầng ứng dụng.

## 7. Dùng AI sinh code

Đưa hợp đồng (OpenAPI/schema/event) cho AI trước; yêu cầu kèm test; tự đọc hiểu từng dòng trước khi mở PR; không dán secret vào prompt.
