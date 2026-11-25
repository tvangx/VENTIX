# AGENTS.md — Quy ước cho agent làm việc trong repo `ticketing-platform`

> File này là **nguồn sự thật duy nhất** về cách agent làm việc. Mọi công cụ (Claude Code, Cursor, Copilot, Codex…) đều phải đọc và tuân thủ.
> Người giao việc hiện tại: **Tuấn** (tech lead). Danh sách việc của Tuấn: `docs/agent/TUAN_PLAN.md`. Trạng thái: `docs/agent/STATUS.md`. Prompt giao việc: `docs/agent/PROMPTS.md`.

## 0. Tóm tắt 10 luật không được vi phạm

1. **Không push vào `main`.** Mỗi task = 1 nhánh = 1 PR.
2. **Mỗi lần chỉ làm đúng 1 task** (ID dạng `T-xxx`). Xong thì dừng, báo cáo, chờ lệnh.
3. **Không tự đoán hợp đồng.** Đổi `packages/event-contracts`, OpenAPI đã bàn giao, schema DB của service khác → dừng và hỏi.
4. **Không bao giờ chạm DB của service khác.** Cần dữ liệu → API hoặc sự kiện Kafka.
5. **Ghi DB + phát sự kiện phải qua Outbox trong cùng transaction.** Consumer phải idempotent (Inbox).
6. **Không commit secret, `.env`, khóa, dữ liệu thật.** Thêm biến môi trường mới → cập nhật `.env.example` và schema validate env.
7. **Không làm yếu kiểm tra để "cho qua"**: không xóa/skip test, không tắt lint, không hạ ngưỡng.
8. **Không bịa kết quả.** Chưa chạy được thì ghi "chưa chạy" và nêu lý do; không viết "test đã pass" nếu không chạy.
9. **Lệnh phá hủy cần hỏi trước** (`make reset`, `docker volume rm`, `DROP`, `git push --force`, `rm -rf` ngoài thư mục build).
10. **Gặp điều kiện dừng ở mục 9 thì dừng và hỏi** (một lần, gom câu hỏi), không tự chọn rồi làm tiếp.

---

## 1. Bối cảnh dự án (đọc trước khi làm bất kỳ task nào)

Nền tảng Web SaaS bán vé sự kiện + merchandise + sàn resale. Microservices, **database-per-service**, chịu tải flash sale: Waiting Room → Redis Lua → PostgreSQL unique index; Kafka + Outbox/Inbox; Saga.

**Thứ tự đọc tài liệu:**

1. `docs/architecture/architecture-v2.md` (mục 2, 3, 4, 5 là cốt lõi)
2. `docs/adr/` (đặc biệt 0001, 0002, 0004, 0005, 0006)
3. `docs/architecture/plan-6-weeks.md` (task, phụ thuộc, DoD)
4. `docs/agent/TUAN_PLAN.md` (đặc tả chi tiết task của Tuấn) và `docs/agent/STATUS.md`
5. `packages/event-contracts/` (hợp đồng Kafka đang có hiệu lực)

**Bản đồ repo**

```
apps/        web, staff-pwa                      (Vũ — KHÔNG đụng nếu không được giao)
services/    identity event booking payment ticket resale merch notification finance
packages/    event-contracts (có sẵn) · outbox-inbox · common · auth-guard
infra/       compose · postgres/init · kafka · kong · (k6, prod: tạo dần)
docs/        adr · architecture · agent · sequence · erd · test-reports
scripts/     check-prereqs · verify-infra · gh-bootstrap · create-issues · gen-issues
```

**Cổng dev:** identity 3001 · event 3002 · booking 3003 · payment 3004 · ticket 3005 · resale 3006 · merch 3007 · notification 3008 · finance 3009 · Kong 8000.
**Quyền sở hữu:** theo `.github/CODEOWNERS`. Việc của Tuấn: `infra/`, `.github/`, `packages/*`, `services/booking`, `services/payment`, `services/finance`, load test, giám sát, deploy. Muốn sửa vùng của người khác → chỉ **đề xuất trong PR/Issue**, không tự sửa.

**Stack đã chốt:** Node 20 · pnpm 9 · TypeScript strict (CommonJS) · NestJS (Express) · Prisma (migration `--create-only` rồi **sửa tay SQL**) · kafkajs · ioredis · jose · pino · zod · Jest + Testcontainers (service) / Vitest (contracts, FE).
Muốn thêm thư viện: xem `docs/agent/CONVENTIONS.md` mục 8. **Image Docker mới:** phải `docker pull` thành công trước khi commit (registry có thể gỡ image, ví dụ `minio/mc`); ghim tag qua biến trong `.env`/`.env.example`; không pull được thì dừng và hỏi.

---

## 2. Quy trình BẮT BUỘC cho mỗi task (Task Run Protocol)

### Bước 0 — Nhận diện và kiểm tra điều kiện

- [ ] Xác định ID task (ví dụ `T-202`). Nếu người dùng không nêu ID → hỏi.
- [ ] Đọc `docs/agent/CONVENTIONS.md` (quy ước code/DB/Kafka/Redis/test) và spec của task trong `docs/agent/TUAN_PLAN.md`, cùng Issue tương ứng (nếu có).
- [ ] Kiểm tra **phụ thuộc** trong `STATUS.md`: nếu task phụ thuộc chưa `Done` → dừng và báo.
- [ ] Kiểm tra spec đủ rõ chưa. Nếu thiếu → liệt kê **giả định** và **câu hỏi** (gom một lần). Chỉ dùng giả định cho chi tiết nhỏ không ảnh hưởng hợp đồng; ghi giả định vào run report.

### Bước 1 — Chuẩn bị nhánh

```bash
git switch main && git pull --ff-only
git switch -c feat/<scope>-t<số>-<mô-tả-ngắn>     # ví dụ: feat/booking-t202-lua-hold-seats
make up && make verify                            # nếu task đụng hạ tầng/DB/Kafka/Redis (cần Docker)
```

Loại nhánh: `feat/` · `fix/` · `chore/` · `docs/`. Chữ thường, gạch ngang.

### Bước 2 — Kế hoạch ngắn (viết vào run report TRƯỚC khi code)

Tạo `docs/agent/runs/T-xxx.md` từ `docs/agent/RUN_REPORT_TEMPLATE.md`, điền mục _Kế hoạch_: file sẽ tạo/sửa, test sẽ viết, rủi ro. Nếu kế hoạch chạm vùng người khác hoặc hợp đồng → dừng, hỏi.

### Bước 3 — Cài đặt

- Làm theo từng phần nhỏ; **commit thường xuyên** (mỗi commit biên dịch được và test liên quan xanh).
- Viết test **cùng lúc** với code (code lõi: test trước).
- Tuân thủ `docs/agent/CONVENTIONS.md`.

### Bước 4 — Kiểm chứng (chạy thật, ghi lại)

```bash
pnpm --filter <package-của-task> lint
pnpm --filter <package-của-task> typecheck
pnpm --filter <package-của-task> test            # unit
pnpm --filter <package-của-task> test:int        # nếu có (Testcontainers, cần Docker)
pnpm --filter <package-của-task> test:conc       # nếu có (concurrency)
pnpm format:check && pnpm build                  # toàn repo trước khi mở PR
```

Chạy lệnh "Kiểm chứng" ghi trong spec của task. **Dán bản tóm tắt kết quả thật** (số test pass/fail) vào run report. Test fail → sửa, không bỏ qua.

### Bước 5 — Tự review (đánh dấu từng mục trong run report)

- [ ] Concurrency: có race condition nào không? Thao tác kiểm-tra-rồi-ghi có atomic (Lua / `UPDATE ... WHERE` có điều kiện / unique index)?
- [ ] Idempotency: gọi lại cùng request/message có an toàn không?
- [ ] Outbox/Inbox: ghi sự kiện cùng transaction; consumer kiểm tra `processed_events`.
- [ ] Bảo mật: không log token/PII; kiểm tra quyền + tenant; input được validate.
- [ ] Cấu hình: biến môi trường mới đã vào `.env.example` + schema validate.
- [ ] Observability: log có `request_id`/`trace_id`; metric cho đường nóng.
- [ ] Không còn `console.log`, `any`, `TODO` không gắn task ID, code chết.

### Bước 6 — Cập nhật tài liệu

- OpenAPI (`pnpm --filter <svc> openapi:export`), README của service, ERD/sequence nếu đổi.
- ADR mới khi: lệch khỏi ADR hiện có, thêm thành phần hạ tầng, đổi hợp đồng, chọn chính sách nghiệp vụ (xem mục 9).
- Cập nhật dòng của task trong `docs/agent/STATUS.md` (`Todo → In review`; chỉ Tuấn chuyển sang `Done` sau khi merge).

### Bước 7 — Mở PR

- Tiêu đề: `T-202 feat(booking): add lua seat hold`
- Mô tả: dùng `.github/PULL_REQUEST_TEMPLATE.md`, thêm: link run report, danh sách giả định, thư viện mới, mục **"Cần 2 người đọc"** nếu chạm Lua/outbox/saga/unique index/mã hóa/TOTP.
- Nếu có thay đổi hợp đồng: thêm nhãn/dòng **`CONTRACT CHANGE`** ở đầu mô tả.
- Không tự merge.

### Bước 8 — Báo cáo cuối và DỪNG

Gửi tin nhắn theo mẫu ở mục 10. **Không bắt đầu task tiếp theo** trừ khi người dùng ra lệnh rõ ràng (ví dụ "làm tiếp T-203").

---

## 3 đến 8. Quy ước chi tiết (đọc bắt buộc)

Đặt tên và cấu trúc, quy ước code, cơ sở dữ liệu, Kafka, Redis và test nằm trong **`docs/agent/CONVENTIONS.md`** (các mục 3 đến 8). Đọc file này ở Bước 0 của mỗi task. Tóm tắt những điều dễ sai nhất:

- TypeScript `strict`, cấm `any`; tiền là số nguyên VND; thời gian UTC; ID là UUID; lỗi trả `application/problem+json`.
- Migration Prisma dùng `--create-only` rồi sửa tay SQL; chuyển trạng thái bằng cập nhật có điều kiện; không truy cập DB của service khác.
- Chỉ dùng schema/topic trong `@ticketing/event-contracts`; chỉ phát qua Outbox; consumer phải idempotent (Inbox).
- Redis: key có hash tag `{evt:<id>}`, logic nhiều bước là Lua trong file `.lua`, mọi key giữ chỗ có TTL; Redis không phải nguồn sự thật.
- Code lõi bắt buộc có test gồm đường lỗi và trùng lặp; thư viện/image mới phải được nêu lý do và kiểm tra pull được.

## 9. Điều kiện DỪNG và HỎI

Dừng, gom câu hỏi và chờ trả lời khi gặp **bất kỳ** điều nào sau đây:

1. Phụ thuộc chưa xong hoặc spec mâu thuẫn với tài liệu kiến trúc/ADR.
2. Cần **đổi hợp đồng**: `event-contracts`, OpenAPI đã bàn giao, schema của service khác. (Ghi rõ `CONTRACT CHANGE` và đề xuất cụ thể.)
3. Phải sửa file thuộc vùng của người khác (CODEOWNERS).
4. Cần **chính sách nghiệp vụ** chưa được chốt (ví dụ xử lý thanh toán đến sau khi đơn hết hạn, giải ngân escrow).
5. Cần thao tác phá hủy, thao tác ngoài máy local (deploy, DNS, tài khoản bên thứ ba), hoặc cần bí mật (`vnp_HashSecret`…).
6. Test fail mà nguyên nhân không rõ sau 2 lần sửa có lập luận.
7. Việc ước lượng vượt gấp đôi so với plan.
8. Không chắc về hành vi của API bên thứ ba (VNPay…): **đọc tài liệu chính thức**; nếu không truy cập được → hỏi, không dựa vào trí nhớ.

**Cách hỏi:** nêu tình huống · các lựa chọn (ưu/nhược) · lựa chọn đề xuất · tác động nếu chọn sai. Tối đa 1 lượt hỏi cho mỗi nút chặn.

## 10. Mẫu báo cáo cuối task (tin nhắn gửi Tuấn)

```
T-xxx <tên task> — <Hoàn thành | Hoàn thành một phần | Bị chặn>
Nhánh: feat/...    PR: <link hoặc "chưa mở">    Run report: docs/agent/runs/T-xxx.md

Đã làm:
- ...
Kiểm chứng (đã chạy thật):
- lệnh → kết quả (số pass/fail)
Chưa kiểm chứng / không chạy được: ... (lý do)
Giả định đã dùng: ...
Thay đổi hợp đồng: không | CONTRACT CHANGE: ...
Thư viện mới: không | ...
Việc cần Tuấn làm: ... (ví dụ chạy `make verify`, nhập secret, review 2 người)
Rủi ro / việc theo sau: ...
Task tiếp theo đề xuất: T-xxx (chờ lệnh)
```

## 11. Chế độ làm việc

- **Mặc định:** từng task (Bước 0 → 8), dừng sau mỗi task.
- **Chế độ lô** (chỉ khi người dùng nói rõ, ví dụ "làm T-201 đến T-203"): vẫn mỗi task một nhánh/PR/run report; dừng ngay khi có điều kiện dừng ở mục 9; không gộp thay đổi của nhiều task vào một PR.
- **Sửa lỗi sau review:** thêm commit vào cùng nhánh, cập nhật run report (thêm mục "Lần chạy N"), không tạo task mới.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
