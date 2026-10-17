# Quy ước chi tiết cho agent (code, DB, Kafka, Redis, test)

> Tách khỏi `AGENTS.md` để file quy tắc chính ngắn gọn (một số công cụ giới hạn độ dài file quy tắc, ví dụ Antigravity: 12.000 ký tự mỗi file).
> **Bắt buộc đọc ở Bước 0 của mỗi task** (AGENTS.md mục 2). Chưa đọc thì chưa được viết code.

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
