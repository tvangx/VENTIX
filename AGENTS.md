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
Muốn thêm thư viện: xem mục 8.

---

## 2. Quy trình BẮT BUỘC cho mỗi task (Task Run Protocol)

### Bước 0 — Nhận diện và kiểm tra điều kiện

- [ ] Xác định ID task (ví dụ `T-202`). Nếu người dùng không nêu ID → hỏi.
- [ ] Đọc spec của task trong `docs/agent/TUAN_PLAN.md` và Issue tương ứng (nếu có).
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
- Tuân thủ mục 4–7 (quy ước code/DB/Kafka/Redis).

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

## 3. Quy ước đặt tên và cấu trúc

**Ngôn ngữ:** code, tên biến, commit message, tên nhánh: **tiếng Anh**. Tài liệu, mô tả PR, run report, comment giải thích nghiệp vụ: **tiếng Việt**.

**Đặt tên:** file `kebab-case.ts` · class/type `PascalCase` · biến/hàm `camelCase` · hằng `UPPER_SNAKE` · bảng `snake_case` số nhiều · cột `snake_case` · topic `domain.noun` · biến môi trường `UPPER_SNAKE` · mã lỗi `UPPER_SNAKE`.

**Cấu trúc một service NestJS**

```
services/<name>/
  src/
    main.ts · app.module.ts
    config/env.schema.ts          # zod, fail-fast khi thiếu biến
    common/                       # filter lỗi, interceptor, decorator dùng riêng service
    modules/<feature>/            # controller · service · repository · dto · *.spec.ts
    messaging/                    # consumers (Inbox) · producers (qua Outbox)
  prisma/schema.prisma · prisma/migrations/
  test/{integration,concurrency,e2e}/
  openapi.json                    # sinh tự động, commit
  Dockerfile · .env.example · README.md
```

**Scripts bắt buộc trong `package.json` mỗi service:** `dev` · `build` · `start` · `lint` · `typecheck` · `test` · `test:int` · `test:conc` · `openapi:export` · `prisma:migrate:create`.

---

## 4. Quy ước code

- TypeScript `strict`. **Cấm `any`** (dùng `unknown` + zod). Cấm `// @ts-ignore` trừ khi có comment lý do + task ID.
- **Tiền = số nguyên VND** (`number` an toàn dưới 2^53, DB `bigint`). **Thời gian = UTC**, chuỗi ISO-8601 ở API/sự kiện, `timestamptz` ở DB. **ID = UUID.**
- Controller mỏng: validate → gọi service → trả DTO. Logic ở service; truy cập DB ở repository. Không gọi Prisma trực tiếp từ controller.
- **Lỗi:** trả `application/problem+json` (RFC 7807) với các trường `type`, `title`, `status`, `detail`, `code`, `request_id`. Ví dụ code: `SEAT_UNAVAILABLE`, `HOLD_LIMIT_EXCEEDED`, `ADMISSION_REQUIRED`, `IDEMPOTENCY_KEY_REUSED`. Không rò stack trace ra client.
- **API:** tiền tố `/v1`; ghi header `Idempotency-Key` cho mọi POST tạo tài nguyên có tác dụng phụ; phân trang cursor; mọi endpoint có decorator OpenAPI đầy đủ (request, response, lỗi).
- **Cấu hình:** chỉ đọc qua `config/env.schema.ts` (zod). Không `process.env` rải rác.
- **Log (pino, JSON):** luôn có `service`, `request_id`, `trace_id`; chỉ log `user_id` (ID), **không** log token, mật khẩu, CCCD, địa chỉ. Mức: `info` luồng chính, `warn` bất thường có thể phục hồi, `error` thất bại.
- **Graceful shutdown:** dừng nhận request → hoàn tất job → đóng Kafka/Redis/DB. Có `/health/live` và `/health/ready`.
- Comment giải thích **vì sao**, không lặp lại **cái gì**. Gắn `TODO(T-xxx)` khi để lại việc.

## 5. Quy ước cơ sở dữ liệu

- Mỗi service chỉ dùng user/DB của mình (`<name>_user` / `<name>_db`). **Không bao giờ dùng user `postgres`.** Không FK/JOIN/view chéo DB; cột tham chiếu ngoài ghi chú `ref:<db>`.
- Migration: `prisma migrate dev --create-only --name <mô_tả>` rồi **mở file SQL, sửa tay** để thêm thứ Prisma không mô hình hóa (partial unique index, CHECK, trigger append-only, `FOR UPDATE SKIP LOCKED` nằm ở code). Tên file migration giữ mặc định của Prisma. Mỗi migration phải chạy được từ DB rỗng.
- Mọi bảng: `id uuid`, `created_at timestamptz default now()`; bảng cập nhật nhiều có `updated_at` + `version int` (optimistic lock). Tiền `bigint`, cột trạng thái dùng CHECK hoặc enum.
- Chuyển trạng thái bằng **cập nhật có điều kiện**: `UPDATE ... SET status=$new, version=version+1 WHERE id=$id AND status=$old AND version=$v` và kiểm tra số dòng ảnh hưởng.
- Mỗi DB có `outbox_events` và `processed_events` (xem `packages/outbox-inbox/sql/outbox_inbox.sql`).
- Bảng sổ cái/audit/check-in: **chỉ INSERT** (thu hồi UPDATE/DELETE).

## 6. Quy ước Kafka

- **Chỉ dùng** schema/topic trong `@ticketing/event-contracts`; luôn publish đúng topic theo `topicOf`, key theo comment trong `topics.ts`. Cần sự kiện/trường mới → `CONTRACT CHANGE` (mục 9).
- **Producer:** chỉ phát qua Outbox relay (idempotent producer, `acks=all`). Không `producer.send` trực tiếp trong handler nghiệp vụ.
- **Consumer:** `parseMessage` (zod) → kiểm tra Inbox → xử lý trong **cùng transaction** → commit offset. Message sai schema → DLQ ngay (không retry vô hạn). Lỗi tạm thời → retry có backoff + jitter, quá N lần → `<topic>.dlq` kèm header lỗi.
- Không giả định thứ tự giữa các key khác nhau; xử lý sự kiện đến muộn/đảo thứ tự bằng version (`event_version`) hoặc điều kiện trạng thái.

## 7. Quy ước Redis

- Tên key theo mẫu `<loại>:{evt:<eventId>}:<định-danh>`; **hash tag `{evt:<id>}` bắt buộc** cho key cùng sự kiện (chuẩn bị Cluster, cho phép Lua nhiều key).
- Logic nhiều bước phải là **Lua script** lưu trong file `*.lua` (không nhúng chuỗi dài trong TS), nạp qua `ioredis.defineCommand`. Script phải: kiểm tra trước, ghi sau; trả mã rõ ràng; không `KEYS`/`SCAN` trong đường nóng.
- **Mọi key giữ chỗ phải có TTL.** Redis chạy `noeviction`: ghi lỗi khi đầy là chủ ý; cache phải có TTL + giới hạn kích thước riêng.
- Redis **không phải nguồn sự thật**: dữ liệu quan trọng luôn có bản trong PostgreSQL (ADR-0002) và có đường rehydrate.

## 8. Quy ước test

| Loại        | Vị trí / đặt tên                  | Ghi chú                                                                    |
| ----------- | --------------------------------- | -------------------------------------------------------------------------- |
| Unit        | `src/**/*.spec.ts`                | Nhanh, không IO                                                            |
| Integration | `test/integration/*.int-spec.ts`  | Testcontainers (Postgres, Redis, Kafka thật)                               |
| Concurrency | `test/concurrency/*.conc-spec.ts` | ≥ 50 tác vụ song song, dữ liệu cố định, kết quả **xác định** (không flaky) |
| E2E         | `test/e2e/*.e2e-spec.ts`          | Qua HTTP + Kong khi cần                                                    |

- Code lõi (Lua, outbox/inbox, saga, state machine, idempotency, mã hóa) **bắt buộc có test**, gồm cả đường lỗi và trùng lặp.
- Test không phụ thuộc thứ tự chạy, không dùng `sleep` cố định (dùng polling có timeout).
- **Thư viện mới:** ưu tiên thứ đã có; nếu thêm phải nêu trong PR: lý do, giấy phép, mức độ bảo trì, kích thước. Phiên bản ghim qua `pnpm-lock.yaml`.

---

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
