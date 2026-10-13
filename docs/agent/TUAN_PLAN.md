# Kế hoạch việc của Tuấn — bản đặc tả đầy đủ 6 tuần cho agent

> Agent: đọc `AGENTS.md` trước. Mỗi lần chỉ làm **một** task theo Task Run Protocol. Trạng thái: `docs/agent/STATUS.md`. Prompt giao việc cho từng task: `docs/agent/PROMPTS.md`. Lộ trình từng bước cho Tuấn: `START_HERE.md`.
> Tuấn phụ trách: hạ tầng · `packages/*` · `services/booking` · `services/payment` · `services/finance` · load test · giám sát · deploy.
> Nguồn ID, ước lượng, phụ thuộc: `docs/architecture/plan-6-weeks.md`. File này **bổ sung chi tiết kỹ thuật** để triển khai không cần quyết định thêm.

## 1. Cách đọc một đặc tả

Mỗi task có: **Mục tiêu · Đầu ra (đường dẫn) · Việc cần làm · Kiểm chứng · Ngoài phạm vi · Lưu ý**. Mục có nhãn **[M]** bắt buộc, **[S]** nên có, **[C]** cắt trước nếu thiếu thời gian (xem mục 7). Thời lượng tính theo ngày công, là ước lượng ban đầu.
Mọi con số hiệu năng trong tài liệu là **mục tiêu đề xuất**; chỉ ghi vào báo cáo số liệu **đã đo thật**.

## 2. Việc của riêng Tuấn (agent không làm được)

| Task         | Việc                                                                        | Khi nào  |
| ------------ | --------------------------------------------------------------------------- | -------- |
| T-105        | Xác nhận CI xanh trên GitHub; chọn 2 check `build`, `security` làm bắt buộc | Tuần 1   |
| T-106        | Đăng ký VNPay sandbox; thử `cloudflared`; đo RAM                            | Tuần 1   |
| T-107        | Workshop 30–45 phút xác nhận hợp đồng, chốt escrow                          | Tuần 1   |
| T-207        | Thuê VPS, domain, secrets                                                   | Tuần 1   |
| T-403, T-504 | Chạy k6 từ máy thứ hai, đưa số liệu cho agent                               | Tuần 4–5 |
| T-502        | Chạy kịch bản chaos trên máy thật                                           | Tuần 5   |
| T-505        | Tạo GitHub environments và secrets                                          | Tuần 5   |
| T-601        | Domain, Cloudflare, token tunnel, bí mật prod, cron backup                  | Tuần 6   |
| T-602        | Chạy tải và chaos trên môi trường thật                                      | Tuần 6   |
| T-604        | Tập dượt, quay video                                                        | Tuần 6   |

**Checklist chi tiết**

- **T-105:** Actions chạy lần đầu xanh; nếu lỗi Trivy/format, dùng prompt "Sửa lỗi" để agent sửa.
- **T-106:** (1) đăng ký tại trang sandbox của VNPay, lưu `vnp_TmnCode` và `vnp_HashSecret` vào trình quản lý mật khẩu (không vào repo); (2) `cloudflared tunnel --url http://localhost:3004` rồi dán URL làm IPN URL trong trang quản trị sandbox; (3) `docker stats --no-stream` và ghi tổng RAM vào `docs/test-reports/ram-phase0.md`.
- **T-107:** theo `docs/dev/messages-for-team.md` (mục 2 và 3). Biên bản ghi vào ADR-0009 nếu có điều chỉnh.
- **T-207:** VPS ≥ 8 GB RAM (đề xuất 16 GB, 4 vCPU), Ubuntu LTS; tạo user deploy, khóa SSH bằng key, tường lửa chỉ mở cổng cần thiết, cài Docker; làm theo `docs/ops/vps-setup.md` do agent soạn.

---

## 3. Quyết định hợp đồng đã chốt (ADR-0009, ADR-0010)

Các khoảng trống phát hiện khi rà saga **đã được chốt**. Agent không thay đổi các quyết định này; thấy mâu thuẫn thì dừng và hỏi.

| #      | Quyết định                                                                                           | Chi tiết                                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **C1** | Thêm `OrderAwaitingPayment`                                                                          | ADR-0009. Payment dựng `payables`; chưa sẵn sàng thì `409 ORDER_NOT_READY` + `Retry-After: 1`                          |
| **C2** | Mở rộng `OrderConfirmed` (items, tách tiền vé/merch, `payment_id`)                                   | ADR-0009. Ticket, merch (commit), finance, notification đều kích hoạt từ `OrderConfirmed`                              |
| **C3** | Thanh toán đến muộn ⇒ tự hoàn tiền                                                                   | ADR-0009. `REFUND_REQUIRED` → `OrderCancelled{LATE_PAYMENT}` → hoàn tiền → `REFUNDED`; `ORDER_EXPIRY_GRACE_SECONDS=30` |
| **C4** | Máy trạng thái order có `REFUND_REQUIRED`                                                            | ADR-0009 (bảng chuyển trạng thái)                                                                                      |
| **C5** | `seat_pricing` lấy bằng prefetch REST nội bộ                                                         | ADR-0010. Sơn: S-206; Tuấn: T-203b                                                                                     |
| **C6** | Báo giá merch đồng bộ, chỉ khi order có merch; combo để tuần 4                                       | ADR-0010. Vũ: V-306 (SKU lẻ), V-406 (combo)                                                                            |
| **C7** | Thanh toán đơn resale đi qua payment-service (`ResaleOrderAwaitingPayment`, `payables` có `purpose`) | ADR-0009. Sơn: S-405; Tuấn: T-405                                                                                      |
| **D7** | `PaymentFailed` không hủy order                                                                      | ADR-0009                                                                                                               |

**T-301a (hợp đồng) đã được cài đặt sẵn** trong repo: `packages/event-contracts` (13 test), ADR-0009, ADR-0010, `docs/api/internal/*.yaml`. Tuấn chỉ cần review và commit; **không giao cho agent làm lại**.

Chưa hỗ trợ ở tuần 3: `voucher_code` (⇒ `422 VOUCHER_NOT_SUPPORTED`), combo (⇒ `422 COMBO_NOT_SUPPORTED`).

---

## 4. Thứ tự thực hiện (đường găng)

```
Tuần 1:  T-102 → T-301a (review/commit) → T-103 → T-201 ; T-105, T-207 ; T-106/T-107 do Tuấn
Tuần 2:  T-202 → T-206 → T-203 → T-204 → T-205 (→ Cổng G1) ; T-203b ngay khi Sơn xong S-206
Tuần 3:  T-301 → T-302 → T-303 → T-304 (→ Cổng G2; T-304 được phép trượt sang đầu tuần 4)
Tuần 4:  T-401 → T-402 → T-403 ; T-404 song song ; T-405 khi Sơn xong S-405 (→ đầu Tuần 5 nếu trễ)
Tuần 5:  T-501 → T-502 → T-504 ; T-503, T-505 song song (→ Cổng G3)
Tuần 6:  T-601 → T-602 ; T-603 song song ; T-604
```

Trạng thái ban đầu: **T-101, T-104 Done** (Phase 0); **T-301a** đã cài đặt sẵn, chờ review; **T-105** có workflow nhưng chưa chạy trên GitHub.

---

# TUẦN 1

## T-102 Template NestJS service — 1,0 ngày — _chặn cả nhóm, làm ngay_

**Mục tiêu:** Sơn/Vũ tạo service mới trong < 1 giờ, đã có sẵn health, log JSON, xác thực JWT, lỗi chuẩn, OpenAPI, Prisma, test mẫu.

**Đầu ra**

- `packages/common` — `createLogger(service)` (pino), `RequestIdMiddleware` (nhận/sinh `X-Request-Id`, gắn vào log), `ProblemException(code, status, detail)` + `ProblemJsonFilter` (RFC 7807), `loadEnv(zodSchema)` (fail-fast).
- `packages/auth-guard` — `JwtAuthGuard` dùng `jose`: **chỉ RS256**, kiểm tra `iss`, `aud`, `exp`; lấy khóa từ `AUTH_JWKS_URI` (cache + làm mới khi gặp `kid` lạ, có cooldown) **hoặc** `AUTH_PUBLIC_KEY_PEM` (chỉ dùng dev/test). Kèm `@Public()`, `@Roles(...)` + `RolesGuard`, `@CurrentUser()` trả `{ userId, roles, organizerId? }`, helper kiểm tra tenant.
- `services/_template` (tên package `@ticketing/service-template`): `main.ts` (pino, helmet, ValidationPipe, graceful shutdown, Swagger `/docs`), `config/env.schema.ts`, `/health/live` + `/health/ready` (kiểm tra DB), `/metrics` (prom-client), khởi tạo OpenTelemetry (chỉ bật khi có `OTEL_EXPORTER_OTLP_ENDPOINT`), Prisma (`datasource` đọc `DATABASE_URL`, chưa có model), Dockerfile nhiều tầng, cấu hình Jest + **một test integration Testcontainers** (Postgres) và một test unit, script `openapi:export`.
- `scripts/new-service.sh <name> <port>` — sao chép template, thay `__SERVICE__`/`__PORT__`/tên package, tạo `.env.example` với `DATABASE_URL=postgresql://<name>_user:<name>_dev@localhost:5432/<name>_db`. Mặc định chỉ chấp nhận tên trong danh sách 9 service (+ `ai`); cờ `--force-name` chỉ dùng để thử.
- Cập nhật `commitlint.config.cjs`: thêm scope `common`, `auth-guard`, `template`, `loadtest`.
- Tài liệu: `docs/dev/new-service.md` (cách tạo service mới, 10 dòng).

**Việc cần làm:** dựng `packages/common` → `packages/auth-guard` (kèm test với cặp khóa sinh trong test) → template → script → chạy thử bằng cách sinh service `demo` rồi **xóa** nó.

**Kiểm chứng**

```bash
pnpm --filter @ticketing/common test && pnpm --filter @ticketing/auth-guard test
bash scripts/new-service.sh demo 3099 --force-name   # chỉ để thử; cờ này bỏ kiểm tra danh sách tên
pnpm --filter @ticketing/demo dev          # GET :3099/health/ready = 200 khi `make up` đang chạy
pnpm --filter @ticketing/demo test && pnpm --filter @ticketing/demo test:int
```

Tiêu chí: token sai chữ ký/hết hạn/`alg` khác RS256 → 401; không token → 401 trừ `@Public()`; lỗi trả `application/problem+json` có `request_id`; `pnpm build && pnpm lint && pnpm typecheck && pnpm test` toàn repo xanh.

**Ngoài phạm vi:** model nghiệp vụ, Kafka/Redis (làm ở T-103/T-202). **Lưu ý:** không dùng Passport; không đọc `process.env` ngoài `loadEnv`.

---

## T-103 `packages/outbox-inbox` — 1,0 ngày

**Mục tiêu:** thư viện Transactional Outbox + Inbox dùng chung (ADR-0005).

**Đầu ra** (`packages/outbox-inbox/src`)

- Giao diện `SqlExecutor { query<T>(sql: string, params?: unknown[]): Promise<T[]> }` + adapter `fromPrismaTx(tx)` và `fromPgClient(client)` — thư viện **không phụ thuộc cứng vào Prisma**.
- `OutboxService.add(exec, message)` — ghi `outbox_events` (`topic` lấy từ `topicOf[type]`, `message_key` do caller truyền, `payload` = envelope đầy đủ); validate bằng `parseMessage` trước khi ghi.
- `OutboxRelay` — vòng lặp polling cấu hình được (`pollIntervalMs`, `batchSize`): trong 1 transaction `SELECT ... WHERE published_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT n` → gửi Kafka (kafkajs, `idempotent: true`, `acks: -1`) → `UPDATE published_at=now()`; `start()/stop()` graceful; metric đếm số đã gửi/lỗi/độ trễ.
- `createInboxConsumer({ groupId, consumerName, topics, db, handler })` — `parseMessage` → trong 1 transaction: `INSERT INTO processed_events ... ON CONFLICT DO NOTHING` (0 dòng ⇒ bỏ qua) → `handler(exec, message)` → commit offset. Sai schema ⇒ DLQ ngay; lỗi tạm thời ⇒ retry backoff + jitter (cấu hình `maxAttempts`), quá hạn ⇒ `<topic>.dlq` kèm header `x-error`, `x-attempts`, `x-original-topic`.
- Đổi `newMessage` trong `event-contracts` sang **UUIDv7** (gói `uuidv7`, nêu trong PR).
- `sql/outbox_inbox.sql` giữ là schema chuẩn; thêm test kiểm tra schema khớp code.

**Kiểm chứng (Testcontainers: Postgres + Kafka/Redpanda)**

1. Ghi nghiệp vụ + outbox cùng transaction; **rollback ⇒ không có sự kiện**.
2. Relay chết giữa lúc publish và chạy lại ⇒ **không mất**, có thể trùng nhưng consumer chỉ xử lý **một lần**.
3. Hai relay chạy song song ⇒ không gửi cùng một dòng hai lần (SKIP LOCKED).
4. Message sai schema ⇒ vào DLQ; handler ném lỗi tạm thời 2 lần rồi thành công ⇒ xử lý đúng 1 lần.
5. Thứ tự trong cùng key được giữ.

**Lưu ý:** đây là mã lõi → **cần 2 người đọc**. Viết README có ví dụ dùng trong 15 dòng.

---

# TUẦN 2

## T-201 Schema `booking_db` — 0,5 ngày — _cần: T-102, T-103_

**Đầu ra:** `services/booking` (tạo bằng `bash scripts/new-service.sh booking 3003`), `prisma/schema.prisma`, migration (`--create-only` rồi sửa tay SQL), thêm SQL của `outbox_events`/`processed_events`.

**Bảng:** `orders`, `order_items`, `seat_allocations`, `ticket_class_stock`, `event_snapshots`, **`seat_pricing`**, `vouchers`, `voucher_redemptions`, `idempotency_keys(key, user_id, request_hash, response jsonb, created_at)`, cộng outbox/inbox. Cột theo ERD mục 5.3 `architecture-v2.md` (đã cập nhật). `event_snapshots` có thêm `event_version int`, `seat_map_version int`, `pricing_ready boolean default false`, `ticket_classes jsonb`. `seat_pricing(event_id, seat_id, seat_map_version, ticket_class_id)`, khóa chính `(event_id, seat_id)`.

**SQL tay bắt buộc trong migration**

```sql
CREATE UNIQUE INDEX uq_seat_active ON seat_allocations (event_id, seat_id) WHERE state IN ('HELD','SOLD');
ALTER TABLE seat_allocations ADD CONSTRAINT ck_seat_alloc_state CHECK (state IN ('HELD','SOLD','RELEASED'));
ALTER TABLE orders ADD CONSTRAINT ck_orders_status CHECK (status IN ('PENDING','AWAITING_PAYMENT','CONFIRMED','EXPIRED','FAILED','CANCELLED','REFUND_REQUIRED','REFUNDED'));
ALTER TABLE order_items ADD CONSTRAINT ck_order_items_type CHECK (item_type IN ('TICKET_SEAT','TICKET_GA','MERCH'));
CREATE INDEX ix_orders_expiry ON orders (expires_at) WHERE status IN ('PENDING','AWAITING_PAYMENT');
CREATE INDEX ix_orders_user ON orders (user_id, created_at DESC);
CREATE INDEX ix_seat_pricing_version ON seat_pricing (event_id, seat_map_version);
ALTER TABLE ticket_class_stock ADD CONSTRAINT ck_stock_range CHECK (sold >= 0 AND sold <= total);
```

**Kiểm chứng (integration):** chèn 2 allocation `HELD` cùng ghế ⇒ lần 2 lỗi `23505`; sau khi chuyển cái đầu sang `RELEASED` ⇒ chèn lại được; `sold` vượt `total` ⇒ vi phạm CHECK; `order_items.item_type='COMBO'` ⇒ vi phạm CHECK; status lạ ⇒ vi phạm CHECK; migration chạy từ DB rỗng. **Cần 2 người đọc** (unique index).

## T-202 Lua giữ ghế + `POST /v1/holds` — 1,0 ngày — _cần: T-201_

**Mục tiêu:** giữ nhiều ghế **all-or-nothing, atomic**, có giới hạn, có TTL (ADR-0002).

**Thiết kế key** (mọi key chung hash tag `{evt:<eventId>}`)

| Key                     | Kiểu    | Nội dung                                                                             |
| ----------------------- | ------- | ------------------------------------------------------------------------------------ |
| `seat:{evt:E}:<seatId>` | String  | `H:<userId>` (có TTL) hoặc `S` (đã bán, không TTL)                                   |
| `hold:{evt:E}:<userId>` | Set     | các `seatId` user đang giữ (cùng TTL)                                                |
| `hexp:{evt:E}`          | ZSET    | member `seatId`, score = thời điểm hết hạn (ms) — dùng cho snapshot và sweeper       |
| `sold:{evt:E}`          | Set     | các `seatId` đã bán                                                                  |
| `delta:{evt:E}`         | Pub/Sub | thông điệp `H:<seatId>` / `A:<seatId>` (available) / `S:<seatId>`                    |
| `holdlog:{evt:E}`       | Stream  | **chỉ khi `HOLDLOG_ENABLED=true`** (test): ghi mỗi lần giữ thành công, phục vụ T-205 |

**Đầu ra:** `src/seat-hold/lua/hold_seats.lua`, `release_seats.lua`, `SeatHoldService`, `SeatHoldController`.

- `hold_seats`: `KEYS[1]` = hold set, `KEYS[2..]` = seat keys; `ARGV` = holderTag `H:<userId>`, ttlSec, maxSeats, nowMs, các seatId. Quy trình: (1) nếu ghế đang có giá trị khác holderTag ⇒ trả `{0, seatKey}` và **không ghi gì**; (2) nếu `SCARD(hold) + số ghế mới > maxSeats` ⇒ `{2}`; (3) ghi tất cả (`SET EX`, `SADD`, `ZADD`, `EXPIRE` set, `PUBLISH`) ⇒ `{1}`. Giữ lại ghế mình đã giữ = **idempotent** và gia hạn TTL.
- `release_seats`: chỉ `DEL` khi giá trị == holderTag; cập nhật `hold`, `hexp`, `PUBLISH A:`.
- API: `POST /v1/holds {event_id, seat_ids[]}` → `201 {expires_at, seat_ids}` · `409 SEAT_UNAVAILABLE {seat_id}` · `422 HOLD_LIMIT_EXCEEDED` · `DELETE /v1/holds` · `GET /v1/holds?event_id=`. `userId` lấy từ JWT. Biến môi trường: `HOLD_TTL_SECONDS` (600), `HOLD_MAX_SEATS` (6), `ADMISSION_REQUIRED` (mặc định `false` đến khi có T-304).
- Chỉ cho giữ khi `event_snapshots.status` cho phép bán và trong `sale_window` (đọc snapshot; chưa có snapshot ⇒ 404 `EVENT_NOT_ON_SALE`).

**Kiểm chứng (`test:conc` + `test:int`)**

1. 100 người **song song** tranh cùng 1 ghế ⇒ đúng 1 thành công.
2. Giữ `[A,B,C]` khi B đã bị người khác giữ ⇒ thất bại và **A, C không bị ghi**.
3. Vượt `HOLD_MAX_SEATS` ⇒ 422, không ghi gì.
4. Release chỉ có hiệu lực với chủ hold; TTL hết ⇒ ghế giữ được lại.
5. Gọi giữ lặp lại cùng ghế bởi cùng user ⇒ 201, TTL được gia hạn.

**Lưu ý:** mã lõi → **2 người đọc**. Không dùng `KEYS`/`SCAN`. Ghi rõ trong README: hold chỉ nằm ở Redis, mất Redis ⇒ user phải giữ lại (chấp nhận được).

## T-203 Consumer `event.lifecycle` + rehydrate — 0,75 ngày — _cần: T-103, T-201, S-203 (hoặc dữ liệu giả)_

- Consumer (`createInboxConsumer`) xử lý `EventApproved/Updated/Cancelled` ⇒ upsert `event_snapshots` **chỉ khi `event_version` mới hơn**: `INSERT ... ON CONFLICT (event_id) DO UPDATE ... WHERE event_snapshots.event_version < EXCLUDED.event_version`. Khởi tạo `ticket_class_stock.total` từ `ticket_classes` (không bao giờ giảm dưới `sold`). `EventCancelled` ⇒ đặt trạng thái không cho bán.
- **Rehydrate job** (chạy khi khởi động, trước khi `/health/ready` = 200; có cờ tắt): dựng lại từ `seat_allocations`: `SOLD` ⇒ `seat:...` = `S` + `sold:{evt}`; `HELD` thuộc order còn hạn ⇒ `H:<userId>` với TTL = còn lại. Dùng `SET ... NX` để không đè dữ liệu mới.
- **Kiểm chứng:** gửi sự kiện cũ sau sự kiện mới ⇒ bị bỏ qua; gửi trùng ⇒ xử lý 1 lần; `FLUSHALL` Redis ⇒ khởi động lại ⇒ trạng thái ghế khớp DB.

## T-203b Prefetch `seat_pricing` — 0,5 ngày — _cần: T-203, S-206 (Sơn)_

**Mục tiêu:** booking có sẵn ánh xạ ghế→hạng vé cục bộ, không gọi service khác khi khách đặt vé (ADR-0010, C5).

- `EventSeatClassesClient` gọi `GET {EVENT_INTERNAL_URL}/v1/internal/events/{id}/seat-classes` theo `docs/api/internal/seat-classes.yaml`: header `X-Internal-Key`, phân trang `cursor`, `limit` mặc định 1000, timeout + retry có backoff.
- Job chạy khi `EventApproved/Updated` có `seat_map_version` **mới** hơn bản đã nạp: nạp từng trang, upsert theo lô (`INSERT ... ON CONFLICT (event_id, seat_id) DO UPDATE`), hoàn tất toàn bộ trang mới đặt `event_snapshots.pricing_ready = true` **trong một transaction**. Idempotent; chạy lại sau lỗi giữa chừng vẫn đúng.
- Chưa `pricing_ready` ⇒ `/holds` và `/checkout` trả `503 EVENT_NOT_READY` kèm `Retry-After`.
- Chưa có S-206: định nghĩa interface client, viết client thật + test với server HTTP giả dựng theo file OpenAPI; script `scripts/seed-seat-pricing.ts` để dev. **Không sửa `services/event`.**
- **Kiểm chứng:** 10.000 ghế qua nhiều trang đều vào bảng; ngắt giữa chừng rồi chạy lại ⇒ đủ dữ liệu, không trùng; `pricing_ready` chỉ true khi đủ; seat map phiên bản cũ không ghi đè phiên bản mới.

## T-204 Trạng thái ghế realtime — 0,5 ngày — _cần: T-202_

- `GET /v1/events/:id/seat-status` ⇒ ảnh chụp: `{ sold: [...], held: [...], as_of }` lấy từ `sold:{evt}` và `ZRANGEBYSCORE hexp now +inf` (nén gọn, không `SCAN`).
- **Delta publisher:** subscribe `delta:{evt:*}`, gộp theo lô **500 ms** rồi đẩy ra endpoint SSE `GET /v1/events/:id/seat-stream` (Vũ nối vào đây; Socket.IO để sau nếu cần). Có `event: snapshot` khi mới kết nối.
- **Sweeper hết hạn hold:** mỗi 1 giây `ZRANGEBYSCORE hexp -inf now` ⇒ `ZREM` + `PUBLISH A:` (TTL tự xóa key ghế, sweeper chỉ lo thông báo). Chạy an toàn khi nhiều replica (dùng `ZREM` trả về số phần tử để chỉ 1 bên thông báo).
- **Kiểm chứng:** giữ ghế ⇒ client SSE nhận `H` trong ≤ 1 giây; hết TTL ⇒ nhận `A`; 2 replica không phát trùng thông báo hết hạn.

## T-205 k6 S1 + verify oversell — 1,0 ngày — _cần: T-202_

**Đầu ra:** `infra/k6/s1-seat-contention.js`, `infra/k6/lib/auth.js`, `scripts/mint-test-tokens.ts` (sinh N JWT RS256 bằng cặp khóa dev; booking chạy với `AUTH_PUBLIC_KEY_PEM`), `scripts/verify-oversell.sh`, `docs/test-reports/s1-baseline.md`.

- Kịch bản: `USERS` (5.000–10.000) VU, `SEATS` (2.000) ghế, mỗi VU thử giữ ghế ngẫu nhiên; biến `BASE_URL`, `EVENT_ID`.
- Chạy với `HOLDLOG_ENABLED=true`, `HOLD_TTL_SECONDS=3600`. **Verifier** đọc stream `holdlog:{evt}` và khẳng định: mỗi ghế **tối đa 1** lần giữ thành công; tổng thành công == số ghế đang bị giữ trong Redis.
- Báo cáo: cấu hình máy, số replica, RPS, p50/p95/p99, tỷ lệ 409/5xx, kết quả verifier, nút cổ chai nhận thấy. **Ghi đúng số đo thực tế; nếu chưa chạy được thì ghi "chưa đo".**
- **Chạy k6 từ máy khác** nếu có thể; nếu cùng máy phải ghi rõ trong báo cáo.
- **Tiêu chí G1:** oversell = 0.

## T-206 Hoàn thiện Kong — 0,75 ngày — _cần: T-104, T-202_

Phase 0 đã có route 9 service + CORS + request-id + rate limit toàn cục. Còn lại:

- Rate limit **riêng** cho `/api/booking/v1/holds`, `/checkout`, `/queue/join` (giá trị đề xuất trong PR, cấu hình được).
- **Chặn mọi đường `/internal` từ bên ngoài** (ADR-0010): route khớp `/api/<service>/v1/internal*` với plugin `request-termination` trả 404 (agent kiểm tra thứ tự ưu tiên route của Kong bằng `curl`, không đoán).
- `infra/kong/kong.loadtest.yml` (giới hạn nới) + `make kong-loadtest`.
- **Kiểm chứng:** `scripts/check-kong.sh` kiểm tra CORS preflight, 429 khi vượt, `X-Request-Id` được trả về, `/api/event/v1/internal/events/x/seat-classes` ⇒ 404 từ Kong; thoát mã ≠ 0 nếu sai. **JWT không verify ở Kong** (ADR-0004).

## T-207 Dựng VPS và deploy thử — 0,5 ngày

**Agent làm:** `infra/compose/docker-compose.prod.yml` (service dùng image, `restart: unless-stopped`, mạng nội bộ, chỉ Kong mở cổng), `infra/deploy/deploy.sh`, `docs/ops/vps-setup.md` (cài Docker, tạo user deploy, firewall, Cloudflare). **Tuấn làm:** thuê VPS, domain, secrets. Không đặt mật khẩu mặc định vào file prod; đọc từ `.env.prod` nằm ngoài git.

---

# TUẦN 3 (trước khi code: chốt C1–C4 ở mục 3)

## T-301 Checkout API — 1,75 ngày — _cần: T-202, T-301a (đã có), T-203b_

Đặc tả đầy đủ nằm trong prompt của task (`docs/agent/PROMPTS.md`, mục T-301). Tóm tắt:

- `POST /v1/checkout` với `Idempotency-Key` bắt buộc. Body: `event_id`, `seat_ids[]`, `ga_items[]`, `merch_items[]`, `voucher_code?` (có giá trị ⇒ `422 VOUCHER_NOT_SUPPORTED`).
- **Giá luôn do server tính:** ghế từ `seat_pricing` + `event_snapshots.ticket_classes`; GA từ `event_snapshots`; merch từ `MerchQuoteClient` (REST nội bộ, **chỉ khi có merch**, timeout 800 ms, retry 1, circuit breaker; lỗi ⇒ `503 MERCH_UNAVAILABLE` chỉ cho order có merch).
- Xác minh hold thuộc user bằng Lua, gia hạn 1 lần lên `ORDER_PAYMENT_WINDOW_SECONDS` (900).
- Một transaction: `orders(PENDING)`, `order_items` (chỉ `TICKET_SEAT`/`TICKET_GA`/`MERCH`), `seat_allocations(HELD)`, trừ `ticket_class_stock` bằng `UPDATE ... WHERE sold + :q <= total`, outbox `OrderCreated`; không có merch ⇒ chuyển luôn `AWAITING_PAYMENT` và outbox `OrderAwaitingPayment`. Vi phạm `uq_seat_active` ⇒ rollback, nhả hold, `409 SEAT_UNAVAILABLE`.
- Có merch: chờ `StockReserved` ⇒ `AWAITING_PAYMENT` + `OrderAwaitingPayment`; `StockRejected` ⇒ `CANCELLED(STOCK_REJECTED)` + nhả ghế/GA.
- Idempotency: cùng key + cùng `request_hash` ⇒ trả kết quả cũ; khác hash ⇒ `422 IDEMPOTENCY_KEY_REUSED`.
- State machine `order-state.ts` theo ADR-0009; `transition(id, from, to, expectedVersion)`.
- **Ngoài phạm vi:** consumer `PaymentSucceeded/Failed`, sweeper, Lua `sell_seats` (T-303), Waiting Room (T-304), voucher, combo, payment-service.
- **Kiểm chứng:** 20 checkout song song cùng key ⇒ 1 order; 2 user cùng ghế ⇒ 1 thắng; rollback ⇒ không có outbox; chuyển trạng thái sai bị từ chối; merch lỗi không ảnh hưởng order chỉ có vé; `ticket + merch = total`; `item_type` không bao giờ là `COMBO`. **Cần 2 người đọc.**

## T-302 `payment-service` + adapter — 1,25 ngày — _cần: T-103, T-301a (đã có); VNPay sandbox cho E2E_

- Tạo service (`bash scripts/new-service.sh payment 3004`), `payment_db` theo ERD 5.4 (đã cập nhật): `payables`, `payments`, `payment_transactions`, `refund_batches`, `refunds`, `reconciliation_runs`.
- **`payables(purpose, ref_id, user_id, event_id, amount_vnd, expires_at, status)`**, khóa `(purpose, ref_id)`: read-model dựng từ `OrderAwaitingPayment` (`purpose=ORDER`; đơn resale thêm ở T-405).
- `POST /v1/payments {order_id, provider}` + `Idempotency-Key`: kiểm tra `payables` còn hạn; chưa có ⇒ `409 ORDER_NOT_READY` + `Retry-After: 1`; mỗi `(purpose, ref_id)` tối đa 1 payment đang hoạt động (`PENDING` hoặc `SUCCEEDED`), **được tạo payment mới sau khi payment trước `FAILED`** (D7); trả `{redirect_url}`. `payments` lưu `purpose`, `ref_id`, `event_id` (sao từ `payables`, T-401 cần). `vnp_ExpireDate` = `payables.expires_at`.
- `interface IPaymentAdapter { createPayment(); verifyReturn(); verifyIpn(); refund(); }`.
- **`MockAdapter`:** URL giả; sau `MOCK_DELAY_MS` (ngẫu nhiên trong khoảng cấu hình) tự gọi IPN nội bộ với tỷ lệ thành công cấu hình; chế độ xác định cho test; cờ gửi IPN **trùng**. (`refund()` hoàn thiện ở T-401.)
- **`VnpayAdapter`:** sinh URL thanh toán, ký **HMAC-SHA512** trên tham số sắp xếp theo thứ tự chữ cái, `vnp_Amount` nhân 100, thời gian theo GMT+7, kiểm tra chữ ký IPN/Return. **Đối chiếu từng tham số, mã phản hồi IPN và cách mã hóa URL với tài liệu sandbox chính thức; không dựa vào trí nhớ. Không truy cập được tài liệu ⇒ dừng và hỏi.**
- Bí mật chỉ đọc từ biến môi trường (`VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL`, `VNPAY_IPN_URL`), không log, không commit.
- **Kiểm chứng:** unit cho ký/verify (vector tự tính độc lập); Mock chạy xong luồng; tạo payment lần 2 sau `FAILED` được, lần 2 khi payment trước `PENDING` bị từ chối; E2E thật với VNPay sandbox do **Tuấn** chạy (cần `cloudflared`).

## T-303 IPN idempotent, outbox, sweeper, bù trừ — 1,0 ngày — _cần: T-301, T-302_

- **IPN:** xác minh chữ ký + số tiền khớp ⇒ TRANSACTION: `INSERT payment_transactions ... ON CONFLICT (provider_txn_id) DO NOTHING`; nếu chèn được ⇒ cập nhật `payments` (điều kiện `status='PENDING'`) + outbox `PaymentSucceeded/Failed`. Luôn trả đúng định dạng phản hồi nhà cung cấp, kể cả khi trùng.
- **booking consumers (ADR-0009):**
  - `PaymentSucceeded`: order `AWAITING_PAYMENT` ⇒ `CONFIRMED`, `seat_allocations HELD→SOLD`, **Lua `sell_seats`** (`SET S`, `SADD sold`, dọn `hold`/`hexp`, `PUBLISH S:`), outbox `OrderConfirmed` đủ trường (items, tách tiền vé/merch, `payment_id`). Order đã `EXPIRED`/`FAILED`/`CANCELLED` ⇒ `REFUND_REQUIRED` + outbox `OrderCancelled{LATE_PAYMENT}`. Order đã `CONFIRMED` (trùng) ⇒ bỏ qua.
  - `PaymentFailed`: chỉ ghi nhận, **không hủy order** (D7); khách thanh toán lại đến khi hết hạn.
  - `StockRejected` ⇒ `CANCELLED(STOCK_REJECTED)`, nhả ghế/stock/GA.
  - `RefundCompleted` ⇒ order `REFUND_REQUIRED`/`CONFIRMED` ⇒ `REFUNDED`.
- **Sweeper hết hạn:** `SELECT ... WHERE status IN ('PENDING','AWAITING_PAYMENT') AND expires_at < now() - interval ':grace seconds' FOR UPDATE SKIP LOCKED LIMIT 100` (`grace` = `ORDER_EXPIRY_GRACE_SECONDS`, 30) ⇒ `EXPIRED`, `seat_allocations RELEASED`, Lua release, trả stock GA, outbox `OrderExpired`.
- **Ca biên bắt buộc có test:** IPN gửi 2–3 lần ⇒ xử lý 1 lần · `PaymentSucceeded` **đến sau khi order hết hạn** ⇒ `REFUND_REQUIRED` + `OrderCancelled{LATE_PAYMENT}` · `PaymentFailed` rồi thanh toán lại thành công ⇒ `CONFIRMED` · IPN đến trước `StockReserved` · sweeper chạy 2 replica ⇒ không xử lý đôi · `PaymentSucceeded` trùng/đảo thứ tự.
- Phần payment tự hoàn tiền khi thấy `OrderCancelled{LATE_PAYMENT}` thuộc **T-401**; T-303 chỉ cần phát đúng sự kiện.

## T-304 Waiting Room — 1,0 ngày — _cần: T-202, T-206_

- `POST /v1/queue/join {event_id}` (idempotent: `ZADD NX queue:{evt:E}`) · `GET /v1/queue/status?event_id=` (SSE: `position` = `ZRANK`, `estimated_wait_sec`, `status`).
- **Admission worker:** mỗi 1 giây lấy `N` người đầu hàng (`N` suy từ `sale_phases.admit_rate`), **chỉ một replica chạy mỗi tick** (khóa Redis `SET NX PX`), phát **admission token** (HS256, bí mật `ADMISSION_TOKEN_SECRET`, claim `sub`, `evt`, `jti`, `exp` 5–10 phút) và lưu `admitted:{evt:E}` có TTL; có trần số người đang được admit đồng thời.
- `AdmissionGuard` bắt buộc cho `/holds` và `/checkout` khi `queue_enabled`; sự kiện `queue_enabled=false` ⇒ bỏ qua; đặt `ADMISSION_REQUIRED=true` mặc định.
- **Kiểm chứng:** tốc độ admit đúng cấu hình; **2 replica không admit gấp đôi**; token thiếu/hết hạn/sai sự kiện ⇒ 403 `ADMISSION_REQUIRED`; join lặp ⇒ giữ nguyên vị trí. **Tiêu chí G2:** happy path end-to-end. Task này làm **cuối tuần 3** và được phép trượt sang đầu tuần 4: khi đó G2 chấp nhận `ADMISSION_REQUIRED=false`, nhưng Waiting Room phải xong trước load test vòng 1 (T-403).

---

# TUẦN 4

> Quy ước trong đặc tả: **[M]** bắt buộc · **[S]** nên có · **[C]** cắt trước nếu thiếu thời gian. Tuần 4 của Tuấn đầy (5,0 ngày). Nếu trễ, cắt theo thứ tự: **[S]/[C] của T-402 → dời T-404 sang đầu tuần 5 → T-405 chỉ làm khi Sơn đã có S-405**.

## T-401 Hoàn tiền đơn lẻ, hoàn lô và tự hoàn tiền — 1,0 ngày — _cần: T-302, T-303_

**Mục tiêu:** mọi khoản tiền đã thu mà không còn vé hợp lệ đều được hoàn đúng một lần, kể cả khi sự cố xảy ra giữa chừng.

**Đầu ra** (`services/payment`, một phần `services/booking`)

- **[M] Tự hoàn tiền (C3, ADR-0009):** consumer `OrderCancelled{reason: LATE_PAYMENT}` ⇒ nếu `payments` của order có `status=SUCCEEDED` và chưa có refund ⇒ tạo `refunds(PENDING)` rồi worker xử lý.
- **[M] Hủy sự kiện:** payment consume `EventCancelled` ⇒ tạo `refund_batches(reason=EVENT_CANCELLED)` và một `refunds` cho **mọi** payment `SUCCEEDED` có `event_id` đó và `purpose=ORDER`. Booking consume `EventCancelled` ⇒ order `PENDING`/`AWAITING_PAYMENT` của sự kiện ⇒ `CANCELLED(EVENT_CANCELLED)`, nhả hold/ghế/GA. (Order `CONFIRMED` được chuyển `REFUNDED` khi nhận `RefundCompleted`, đã có ở T-303.)
- **[M] Worker hoàn tiền:** lấy `refunds` `PENDING` bằng `FOR UPDATE SKIP LOCKED`; giới hạn `REFUND_CONCURRENCY` (5) và `REFUND_RATE_PER_SEC`; gọi `adapter.refund` với khóa idempotent là `refund.id`; thành công ⇒ `SUCCEEDED` + outbox `RefundCompleted` trong cùng transaction; lỗi ⇒ `attempts+1`, `next_attempt_at` theo backoff lũy thừa + jitter; vượt `REFUND_MAX_ATTEMPTS` (5) ⇒ `NEEDS_MANUAL`. Tiến trình bị chết giữa chừng thì chạy lại vẫn đúng (không hoàn hai lần).
- **[M] Ràng buộc DB:** `UNIQUE(payment_id)` trên `refunds` (hoàn toàn phần, mỗi payment tối đa một refund); chuyển trạng thái bằng cập nhật có điều kiện.
- **[M] API Admin** (role `ADMIN`, kiểm bằng `auth-guard`): `POST /v1/admin/refunds {order_id, reason}`; `POST /v1/admin/refund-batches {event_id, reason}`; `GET /v1/admin/refund-batches/{id}` (tiến độ: tổng, thành công, đang chờ, cần xử lý tay); `GET /v1/admin/refunds?status=`; `POST /v1/admin/refunds/{id}/retry` (chỉ cho `NEEDS_MANUAL`). Mỗi hành động của Admin phát `AuditRecorded` qua outbox.
- **[M] `adapter.refund`:** `MockAdapter` (thành công mặc định; cấu hình tỷ lệ lỗi, chế độ xác định cho test) và `VnpayAdapter` (API hoàn tiền của VNPay: **đối chiếu tham số, chữ ký và mã phản hồi với tài liệu sandbox chính thức**; không truy cập được thì dừng và hỏi; không dựa vào trí nhớ). `vnp_RequestId` (hoặc tương đương) lấy từ `refund.id` để provider cũng idempotent.
- **[S]** Metric `refunds_total{status}`; log có `refund_id`, `payment_id`, `batch_id`.

**Kiểm chứng (integration + concurrency)**

1. `OrderCancelled{LATE_PAYMENT}` đến 3 lần ⇒ đúng 1 refund, đúng 1 `RefundCompleted`.
2. `EventCancelled` với 500 payment `SUCCEEDED` ⇒ 500 refund; kill worker giữa chừng rồi chạy lại ⇒ không hoàn đôi, không bỏ sót.
3. Adapter lỗi tạm thời 2 lần rồi thành công ⇒ `SUCCEEDED`; lỗi mãi ⇒ `NEEDS_MANUAL`; `retry` rồi thành công ⇒ `SUCCEEDED`.
4. Hai worker chạy song song ⇒ mỗi refund chỉ được một worker xử lý.
5. Không phải `ADMIN` ⇒ 403; có `AuditRecorded` cho mỗi hành động Admin.
6. Chuỗi đầy đủ: thanh toán đến muộn ⇒ `REFUND_REQUIRED` ⇒ hoàn tiền ⇒ `RefundCompleted` ⇒ order `REFUNDED` (kết hợp với T-303).

**Ngoài phạm vi:** hoàn một phần; hoàn tiền đơn resale (ghi vào hạn chế đã biết); gửi email (notification của Vũ lắng nghe `RefundCompleted`). **Cần 2 người đọc** (hoàn tiền = tiền thật).

## T-402 `finance-service` — 1,5 ngày — _cần: T-103, T-303_

**Mục tiêu:** sổ cái bất biến, doanh thu tách vé/merch kèm VAT, audit log chống sửa, thống kê cho dashboard Organizer.

**Đầu ra:** `services/finance` (`bash scripts/new-service.sh finance 3009`), `finance_db` (ERD mục 5.9, có bổ sung bên dưới).

- **[M] Consumer (Inbox, idempotent):** `OrderConfirmed`, `RefundCompleted`, `EventApproved/Updated` (dựng `events_ref(event_id, organizer_id, title)` để kiểm tra quyền theo tenant), `AuditRecorded`.
- **[M] Sổ cái `ledger_entries` (chỉ INSERT):** mỗi `OrderConfirmed` ghi một nhóm bút toán cùng `txn_id`: Nợ `PROVIDER_RECEIVABLE` = tổng; Có `REVENUE_TICKET`, `REVENUE_MERCH` (phần chưa thuế), `VAT_PAYABLE_TICKET`, `VAT_PAYABLE_MERCH`. Số tiền tính bằng số nguyên VND; quy tắc làm tròn ghi trong code và ADR; luôn có `net + vat = gross`. **Constraint trigger `DEFERRABLE INITIALLY DEFERRED`** kiểm tra mỗi `txn_id` cân bằng (Nợ = Có) khi commit. Trigger chặn `UPDATE`/`DELETE` và thu hồi quyền tương ứng của `finance_user`.
- **[M] VAT cấu hình được:** `VAT_RATE_TICKET`, `VAT_RATE_MERCH`, `PRICES_INCLUDE_VAT` (mặc định `true`). **Giá trị mặc định chỉ là giả định để phát triển; cần xác nhận với quy định thuế hiện hành trước khi dùng trong báo cáo** (ghi rõ trong README và ADR).
- **[M] `revenue_records`:** mỗi order có các dòng theo `category` (`TICKET`, `MERCH`) với `gross`, `net`, `vat_rate`, `vat`, `items jsonb` (bản chụp item để hoàn ngược), `reversed_at`.
- **[M] Hoàn ngược:** `RefundCompleted` ⇒ tìm `revenue_records` theo `order_id` ⇒ ghi bút toán **đảo** (không sửa bút toán cũ), đặt `reversed_at`; số tiền hoàn khác tổng order ⇒ ghi `AuditRecorded` cảnh báo và không đảo.
- **[M] Thống kê (read-model):** `event_sales_stats(event_id, ticket_class_id, sold, revenue_vnd)` và `event_revenue_stats(event_id, category, gross, net, vat)` cập nhật trong cùng transaction với revenue; hoàn tiền thì trừ lại.
- **[M] API thống kê:** `GET /v1/organizer/events/{id}/stats` (role `ORGANIZER` với tenant khớp `events_ref.organizer_id`, hoặc `ADMIN`).
- **[S] Audit hash-chain:** consume `AuditRecorded` ⇒ `audit_logs` với `hash = SHA256(prev_hash ‖ JSON chuẩn hóa của bản ghi)`, `prev_hash` bản đầu là 64 ký tự `0`; ghi tuần tự bằng `pg_advisory_xact_lock`; `GET /v1/admin/audit/verify` tính lại chuỗi, trả `{ok, checked, first_broken_id?}`; `GET /v1/admin/audit` (lọc, phân trang cursor). Chỉ INSERT.
- **[S] Dead-letter admin:** `DlqCollector` consume các topic `*.dlq` vào bảng `dead_letters` (topic gốc, key, message_id, lỗi, payload, trạng thái); `GET /v1/admin/dlq`, `POST /v1/admin/dlq/{id}/replay` (phát lại lên topic gốc với **cùng `message_id`**, Inbox sẽ chặn trùng), `POST /v1/admin/dlq/{id}/discard`. Nếu không kịp, Vũ dùng Kafka UI cho demo.
- **[C]** SSE `GET /v1/organizer/events/{id}/stats-stream` (cập nhật khi có thay đổi, tối đa 1 lần/2 giây). Nếu cắt, dashboard dùng polling REST 2–5 giây.
- **[M] Schema cho Sơn (S-505):** tạo bảng `invoices`, `invoice_items` theo ERD; **không** viết logic hóa đơn. Không làm `payouts` (ghi vào hạn chế đã biết).
- Xuất `openapi.json`; thêm `docs/api/finance.yaml` tham chiếu để Vũ làm V-502.

**Kiểm chứng**

1. Tổng Nợ = tổng Có với mọi `txn_id`; thử chèn nhóm bút toán lệch ⇒ commit thất bại.
2. `UPDATE`/`DELETE` trên `ledger_entries` và `audit_logs` ⇒ bị chặn kể cả bằng SQL trực tiếp bằng `finance_user`.
3. Thuộc tính (property test): với nhiều mức giá/VAT, `net + vat = gross`.
4. `OrderConfirmed` trùng ⇒ ghi 1 lần. `RefundCompleted` ⇒ tổng doanh thu của order về 0 và `event_sales_stats` giảm đúng.
5. Sửa tay một bản ghi `audit_logs` bằng quyền superuser ⇒ `verify` báo đúng `first_broken_id`. Ghi song song 50 audit ⇒ chuỗi vẫn hợp lệ.
6. Organizer A không xem được thống kê event của B (403).

**Ngoài phạm vi:** hóa đơn điện tử (S-505), payout, báo cáo thuế hoàn chỉnh. **Cần 2 người đọc** (sổ cái, trigger, hash-chain).

## T-403 Load test vòng 1 và tối ưu — 1,5 ngày — _cần: Cổng G2, T-304 (T-404 nên xong để có số đo)_

**Mục tiêu:** có số đo đáng tin cho S1–S3, tìm và xử lý nút cổ chai, **không đánh đổi tính đúng đắn**.

**Đầu ra**

- `infra/compose/docker-compose.apps.yml` (chạy các service trong container, build từ `Dockerfile` của từng service; scale được bằng `--scale`), `infra/kong/kong.apps.yml` (upstream theo tên container), `make apps-up`/`apps-down`/`apps-scale svc=booking n=3`. **Kiểm tra bằng thực nghiệm** rằng Kong phân tải qua nhiều replica (header `X-Served-By` chứa id instance, thêm vào booking); nếu DNS round-robin không hoạt động, dùng khai báo `upstreams` với nhiều `targets`.
- PgBouncer cho `booking_db` và `payment_db` (chế độ transaction; Prisma cần `?pgbouncer=true`). **Chọn image còn pull được và ghi lý do vào PR**; không pull được thì dừng và hỏi.
- `infra/k6/s2-read-heavy.js`, `infra/k6/s3-full-flow.js` (dùng lại `lib/auth.js` của T-205), `scripts/verify-consistency.sh`, `docs/test-reports/loadtest-1.md`.
- **Kịch bản**
  - **S1:** như T-205 (5.000–10.000 VU, 2.000 ghế).
  - **S2 (đọc nặng):** 10.000 VU xem danh sách/chi tiết sự kiện và `seat-status`; tăng dần 1 phút, giữ 3 phút.
  - **S3 (luồng đầy đủ):** 500 VU: `queue/join` ⇒ `holds` ⇒ `checkout` ⇒ thanh toán Mock (90% thành công, trễ 1–3 giây, 5% IPN trùng) ⇒ poll đến `CONFIRMED`. Bật Waiting Room.
- **Script kiểm tra đúng đắn** sau mỗi lần chạy (đợi consumer và relay hết backlog): không có ghế `SOLD` trùng; số order `CONFIRMED` khớp số `OrderConfirmed` đã phát và số `revenue_records` (và số `tickets` nếu `ticket-service` của Sơn đã chạy); không còn order quá hạn chưa xử lý; `outbox_events` chưa gửi = 0; DLQ trống; sổ cái cân bằng.

**Quy trình tối ưu (mỗi lần đổi một thứ):** đo baseline với 1 replica ⇒ xác định nút cổ chai bằng số liệu (chờ pool DB, độ trễ Redis, độ trễ event loop, lag Kafka, CPU) ⇒ ghi giả thuyết ⇒ đổi một thứ (kích thước pool, PgBouncer, index qua `EXPLAIN ANALYZE`, `batchSize`/`pollIntervalMs` của relay, số replica 1→2→3) ⇒ đo lại ⇒ giữ hoặc hoàn tác. **Mỗi thay đổi ghi vào bảng: thay đổi · giả thuyết · trước · sau · giữ?**
**Không được:** bỏ unique index/kiểm tra đúng đắn, nới rate limit để che lỗi mà không ghi rõ, đo trên cấu hình khác với cấu hình báo cáo.

**Báo cáo `loadtest-1.md`:** cấu hình máy và replica, k6 chạy ở đâu (cùng máy hay máy khác), bảng RPS/p50/p95/p99/tỷ lệ lỗi theo kịch bản và số replica, nút cổ chai, bảng thay đổi, kết quả `verify-consistency`. **Mục tiêu đề xuất (chốt lại sau khi đo): S2 p95 < 300 ms; S3 lỗi 5xx < 1%; oversell = 0 tuyệt đối.** Ghi đúng số đo thực tế; chưa đo được thì ghi "chưa đo".

**Việc của Tuấn:** chạy k6 từ máy thứ hai nhắm vào máy chủ; dán số liệu thật cho agent khi agent không tự chạy được.

## T-404 Prometheus + Grafana cơ bản — 0,5 ngày — _cần: T-102_

**Đầu ra:** `infra/compose/docker-compose.obs.yml`, `infra/prometheus/prometheus.yml`, `infra/grafana/provisioning/{datasources,dashboards}/`, `infra/grafana/dashboards/red.json`, `make obs-up`/`obs-down`.

- Prometheus (cổng 9090) scrape `/metrics` của từng service (dev: `host.docker.internal:<cổng>`; apps compose: theo tên container). Grafana (cổng **3030**, tránh trùng cổng web) với datasource và dashboard được **provision bằng file**, không cấu hình tay.
- **[M]** Kiểm tra `packages/common` đã có histogram HTTP (`http_server_request_duration_seconds` với nhãn `service`, `method`, `route`, `status_class`); thiếu thì thêm `HttpMetricsInterceptor` và dùng trong template. **Không** gắn id người dùng/sự kiện làm nhãn (tránh bùng nổ nhãn).
- **[M]** Dashboard RED: Rate, Errors (tỷ lệ 5xx), Duration (p50/p95/p99) theo service; biến chọn service.
- Image phải `docker pull` được; ghim tag qua `.env`.
- **Kiểm chứng:** `make obs-up`; chạy k6 smoke ngắn; Prometheus API báo `up == 1` cho các service đang chạy; dashboard hiện dữ liệu (chụp ảnh đưa vào `docs/test-reports/obs-red.png`).

## T-405 Payment cho đơn resale — 0,5 ngày — _cần: T-302, S-405 (hoặc server giả)_

**Mục tiêu:** thanh toán đơn resale đi qua cùng `payment-service` (ADR-0009 C7).

- Consumer `ResaleOrderAwaitingPayment` ⇒ `payables(purpose=RESALE, ref_id=resale_order_id)`.
- `POST /v1/payments` nhận `{resale_order_id, provider}` (hoặc `{order_id, provider}` như cũ; đúng một trong hai, nếu không ⇒ 422). `payments.purpose/ref_id/event_id` lưu đúng.
- Thanh toán thành công ⇒ outbox `PaymentSucceeded{purpose: RESALE, resale_order_id}`; thất bại ⇒ `PaymentFailed{purpose: RESALE, ...}`; `resale-service` (Sơn) lắng nghe để hoàn tất đơn.
- Dùng lại IPN idempotent của T-303; không tạo luồng riêng.
- **Kiểm chứng:** Mock hoàn tất thanh toán resale; IPN trùng ⇒ 1 `PaymentSucceeded`; tạo payment cho `resale_order_id` chưa có `payables` ⇒ `409 ORDER_NOT_READY`; gửi cả hai khóa ⇒ 422.
- **Ngoài phạm vi:** hoàn tiền đơn resale (ghi vào hạn chế đã biết).

---

# TUẦN 5

> Tuần 5 kết thúc bằng **Cổng G3 (feature freeze)**. Thứ tự: T-501 → T-502 → T-504; T-503, T-505 song song.

## T-501 Giám sát đầy đủ: Loki, exporters, Jaeger — 0,75 ngày — _cần: T-404_

Ưu tiên bên trong task: **[M]** logs + exporters + dashboard hệ thống/nghiệp vụ · **[S]** Jaeger + trace HTTP · **[C]** trace qua Kafka và plugin OpenTelemetry của Kong (cắt trước, xem đường cắt giảm).

- **[M] Loki + Promtail** (`infra/loki`, `infra/promtail`): thu log container (service chạy trong container ở apps compose), pipeline `json` để lọc theo `request_id`, `trace_id`, `service`, `level`; dashboard "Logs" và ví dụ truy vấn trong README. Mount `docker.sock` chỉ ở môi trường dev/test.
- **[M] Exporters:** kafka-exporter (lag theo consumer group/topic), redis_exporter (ops/s, bộ nhớ, `evicted_keys`, kết nối), postgres_exporter (kết nối theo database; **dùng tài khoản chỉ đọc**, ghi rõ trong tài liệu). **Mỗi image phải pull được**; không thì dừng và hỏi.
- **[M] Metric nghiệp vụ** (booking/payment/lib): `orders_total{status}`, `seat_holds_total{result=ok|conflict|limit}`, `queue_length`, `outbox_pending` (gauge định kỳ), `inbox_duplicates_total`, `dlq_published_total{topic}`, `payments_total{status}`, `refunds_total{status}`. Không dùng nhãn có độ phân tán cao.
- **[M] Dashboard:** "System" (Kafka lag, Redis, kết nối DB, CPU/RAM container) và "Business" (đơn theo trạng thái, giữ ghế thành công/xung đột, độ dài hàng đợi, outbox tồn, DLQ).
- **[S] Jaeger** (`jaegertracing/all-in-one` hoặc bản tương đương còn hỗ trợ; ghi phiên bản): các service xuất OTLP khi có `OTEL_EXPORTER_OTLP_ENDPOINT`; trace HTTP end-to-end.
- **[C]** Truyền `traceparent` qua header Kafka: gắn khi `OutboxRelay` publish, đọc khi `createInboxConsumer` xử lý; plugin `opentelemetry` của Kong (kiểm tra có trong Kong 3.8).
- **Kiểm chứng:** tìm một đơn theo `request_id` trong Loki thấy log của ≥ 3 service; dashboard System/Business hiện dữ liệu khi chạy k6; dừng Kafka thì `outbox_pending` tăng và lag đổi; (nếu làm [S]/[C]) một trace nối gateway ⇒ booking ⇒ payment.

## T-502 Chaos test S4 — 1,25 ngày — _cần: T-403_

**Mục tiêu:** chứng minh hệ thống chịu lỗi đúng như ADR mô tả, sửa các chỗ không đúng.

**Đầu ra:** `infra/chaos/run-chaos.sh <kịch bản>` (dùng `docker compose stop/start/pause`; trên Git Bash đặt `MSYS_NO_PATHCONV=1`), `docs/test-reports/chaos-s4.md`, các bản sửa lỗi phát hiện được (mỗi bản sửa kèm test).

| #   | Kịch bản (chạy trong lúc S3 đang tải)    | Hành vi mong đợi                                                                                                                                     |
| --- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Dừng Redis 60 giây                       | `/holds` và `/checkout` trả `503` nhanh (≤ 1 giây, **không treo**), không có order lỡ dở; Redis lên lại ⇒ phục vụ lại trong vài giây; không oversell |
| 2   | `FLUSHALL` Redis + khởi động lại booking | Rehydrate dựng lại trạng thái ghế từ DB; không bán trùng                                                                                             |
| 3   | Dừng Kafka 2 phút                        | HTTP vẫn nhận checkout (ghi DB + outbox); `outbox_pending` tăng; Kafka lên ⇒ backlog tự xả, **không mất, không trùng**                               |
| 4   | Payment trễ vượt hạn order               | Thanh toán đến muộn ⇒ `REFUND_REQUIRED` ⇒ tự hoàn tiền; không vé nào được phát cho order đã hết hạn                                                  |
| 5   | Khởi động lại `booking_db`               | `503` có kiểm soát, pool kết nối tự phục hồi, không order lỡ dở                                                                                      |
| 6   | Kill một replica booking giữa tải        | Replica còn lại tiếp tục; sweeper/relay không xử lý đôi (SKIP LOCKED)                                                                                |
| 7   | Bão IPN trùng (gửi 50 lần mỗi IPN)       | Mỗi thanh toán chỉ xử lý 1 lần                                                                                                                       |

- **Cần sửa mã (nếu chưa có):** `ioredis` với `enableOfflineQueue: false`, `maxRetriesPerRequest` thấp, `commandTimeout`; `/holds` trả `503 HOLD_BACKEND_UNAVAILABLE`; `/health/ready` phản ánh Redis/DB; kết nối lại tự động.
- **Sau mỗi kịch bản** chạy `scripts/verify-consistency.sh` (từ T-403). Báo cáo ghi: kịch bản · mong đợi · thực tế · thời gian phục hồi · bản sửa · kết quả kiểm tra. **Kịch bản chưa chạy được thì ghi "chưa chạy".**
- **Việc của Tuấn:** chạy kịch bản trên máy thật (agent không có quyền dừng container của bạn).

## T-503 Hardening bảo mật — 1,0 ngày

**Mục tiêu:** bằng chứng cho phần "bảo mật dữ liệu" khi bảo vệ.

- **[M] Quét ứng dụng:** OWASP ZAP (`zap-api-scan` với OpenAPI `openapi.json` của từng service, chạy bằng container; không quét hệ thống của bên thứ ba). Báo cáo `docs/test-reports/zap.md`; sửa mọi lỗi mức cao; kết quả giả dương ghi lý do ở `.zap/rules.tsv`.
- **[M] Bí mật:** hỗ trợ biến `*_FILE` trong `loadEnv` (đọc giá trị từ file Docker secret); prod compose dùng `secrets:` cho mật khẩu DB, khóa JWT, `INTERNAL_API_KEY`, `VNPAY_*`; không còn bí mật trong biến môi trường lộ qua `docker inspect` ở prod. `gitleaks`: hook pre-commit (nếu cài) và job CI (dùng binary hoặc action; lưu ý điều kiện giấy phép của action với tổ chức).
- **[M] Container:** mọi `Dockerfile` chạy user không phải root, `HEALTHCHECK`, không cài công cụ thừa; CI quét image bằng Trivy (`CRITICAL,HIGH` làm fail), `pnpm audit --prod` không còn lỗi cao/nghiêm trọng chưa được ghi chú.
- **[M] Mạng prod:** chỉ Kong (hoặc tunnel) tiếp xúc internet; DB/Redis/Kafka chỉ trong mạng nội bộ.
- **[M] Rate limit và đầu vào:** tinh chỉnh giới hạn riêng cho đăng nhập/đăng ký (route của Sơn), `holds`, `checkout`, `queue/join`; giới hạn kích thước body; kiểm tra CORS chỉ cho phép đúng origin.
- **[S]** Tài liệu xoay `INTERNAL_API_KEY` và khóa JWT không làm gián đoạn dịch vụ.
- **Đầu ra:** `docs/security/hardening-checklist.md`: bảng đối chiếu **OWASP API Security Top 10** với biện pháp trong hệ thống và **đường dẫn bằng chứng** (test, cấu hình, báo cáo). Mục chưa đáp ứng ghi thẳng là chưa đáp ứng.
- **Kiểm chứng:** ZAP không còn lỗi cao; thử đường `/internal` từ ngoài ⇒ 404; token sai thuật toán ⇒ 401 (test từ T-102 còn chạy); `gitleaks` quét lịch sử không có bí mật.

## T-504 Load test vòng 2 — 0,75 ngày — _cần: T-502, T-501, T-503_

- Chạy lại S1–S3 trên cùng cấu hình như vòng 1 **sau** các bản sửa tuần 4–5; thêm **soak test** 20–30 phút tải vừa để phát hiện rò rỉ (RAM tăng đều, kết nối DB không trả, lag Kafka trôi).
- Đo **khả năng co giãn:** 1 → 2 → 3 replica booking (RPS và p95).
- `docs/test-reports/loadtest-2.md`: so sánh với vòng 1 cạnh nhau, bảng năng lực (RPS bền vững, p95 theo kịch bản), giới hạn đã biết, kết quả `verify-consistency`. Không tối ưu mới trừ khi có suy giảm so với vòng 1 (khi đó ghi nguyên nhân).
- **Ghi đúng số đo thực tế.** Việc của Tuấn: chạy k6 từ máy thứ hai.

## T-505 Pipeline deploy — 1,0 ngày — _cần: T-207_

- **CI/CD (GitHub Actions):** `deploy-staging.yml` chạy khi CI trên `main` xanh: build image từng service có `Dockerfile` (matrix), quét Trivy, đẩy lên GHCR (`ghcr.io/<owner>/ticketing-<service>:<sha>`), SSH vào VPS chạy `infra/deploy/deploy.sh <sha>`; `deploy-prod.yml` chạy tay (`workflow_dispatch`) với **environment có người duyệt**.
- **`deploy.sh`:** pull image theo `IMAGE_TAG` ⇒ chạy **migration** (`prisma migrate deploy`, mỗi service một job một lần, chạy trước khi bật bản mới) ⇒ `up -d` ⇒ `scripts/smoke-test.sh` (health các service + một API đọc qua Kong) ⇒ thất bại thì **tự khôi phục** `.last_good` (tag trước đó). Ghi `.last_good` khi smoke test đạt.
- Dùng lại `docker-compose.apps.yml` (T-403) làm nền, ghi đè bằng `image:` từ GHCR. Quy ước migration "mở rộng rồi thu hẹp" (không đổi/xóa cột trong cùng bản phát hành), ghi vào `docs/ops/migrations.md`.
- **Việc của Tuấn:** tạo GitHub environments (`staging`, `production`) và secrets (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`), quyền `packages: write`, người duyệt cho `production`.
- **Kiểm chứng:** merge vào `main` ⇒ staging tự cập nhật; cố ý làm smoke test fail ⇒ tự quay về bản trước; prod chỉ chạy sau khi có người duyệt.

---

# TUẦN 6

> Tuần 6 **không thêm tính năng**. Mọi việc là ổn định, đo, ghi lại, tập dượt.

## T-601 Deploy production — 1,0 ngày — _cần: T-505, Cổng G3_

- **Truy cập:** domain qua Cloudflare. Mặc định dùng **Cloudflare Tunnel** (`cloudflared` chạy trong compose, token là secret) để không mở cổng vào; phương án dự phòng: Cloudflare proxy + chứng chỉ gốc trên Kong. TLS chế độ Full (strict).
- **Backup:** `infra/backup/backup.sh` (`pg_dump` từng database ⇒ nén ⇒ đẩy lên bucket MinIO `backups`, giữ 7 bản hằng ngày) chạy bằng cron/timer trên VPS; `infra/backup/restore.sh <db> <file>`.
- **Diễn tập khôi phục (bắt buộc, thực hiện thật):** khôi phục `booking_db` vào database tạm, so số dòng các bảng chính, ghi **thời gian khôi phục thực tế** vào `docs/ops/restore-drill.md`.
- **Giám sát prod:** Grafana đặt sau xác thực (basic auth hoặc Cloudflare Access), không mở công khai.
- **Runbook `docs/ops/runbook.md`:** khởi động/dừng, deploy, rollback, xem log, khôi phục, xoay bí mật, xử lý sự cố thường gặp (Kafka đầy, DLQ có message, Redis đầy, order kẹt).
- **Việc của Tuấn:** domain, Cloudflare, token tunnel, bí mật prod, cron backup.
- **Kiểm chứng:** truy cập bằng domain qua HTTPS; smoke test prod xanh; biên bản restore có số liệu thật; Grafana không truy cập được khi chưa xác thực.

## T-602 Load test và chaos lần cuối trên môi trường thật — 1,0 ngày — _cần: T-601_

- Chạy S1–S4 từ **máy ngoài VPS** nhắm vào staging/prod. Cloudflare có thể chặn hoặc giới hạn lưu lượng tải: **chạy vào subdomain không qua proxy hoặc staging**, ghi rõ cách chạy.
- `docs/test-reports/performance-final.md`: cấu hình VPS và số replica, kết quả so với vòng 1–2, bảng năng lực, giới hạn đã biết, kiểm tra đúng đắn sau từng kịch bản. Mọi con số dẫn tới báo cáo gốc; **không số liệu nào không có nguồn đo**.
- **Việc của Tuấn:** chạy k6 và chaos trên môi trường thật, đưa số liệu cho agent.

## T-603 Tài liệu cuối — 1,5 ngày

**Nguyên tắc:** mô tả **hệ thống đã có**, không mô tả hệ thống dự định. Phần chưa làm ghi thẳng vào hạn chế. Mọi số liệu hiệu năng dẫn đường link báo cáo đo.

**Đầu ra (`docs/final/`)**

1. `01-architecture.md` (kiến trúc thực tế, sơ đồ cập nhật theo code) · 2. `02-concurrency.md` (6 lớp phòng thủ, bằng chứng, báo cáo) · 3. `03-data-model.md` (ERD từng service theo `schema.prisma` thực tế) · 4. `04-sequences.md` (đặt vé và saga, thanh toán muộn, hoàn lô, resale, check-in offline do Sơn bổ sung) · 5. `05-security.md` (từ hardening checklist) · 6. `06-testing.md` (các loại test, mục lục báo cáo) · 7. `07-operations.md` (trỏ runbook) · 8. `08-known-limitations.md` · 9. `09-demo-script.md` (phối hợp Vũ).

- Rà tất cả ADR: đổi trạng thái thành "Đã chấp nhận" hoặc "Bị thay thế"; thêm ADR cho các quyết định đã phát sinh khi làm (ví dụ chọn Prisma kèm SQL tay, kafkajs, PgBouncer, cách làm tròn VAT).
- **Kiểm chứng:** mọi lệnh trong tài liệu chạy được trên máy sạch; mọi đường dẫn tồn tại; không còn mô tả sai so với code (agent đối chiếu và liệt kê các chỗ lệch cho Tuấn duyệt).

## T-604 Sửa lỗi, diễn tập, chuẩn bị bảo vệ — 0,5 ngày

- **Sửa lỗi** theo prompt "Sửa lỗi" (tái hiện ⇒ viết test đỏ trước ⇒ sửa ⇒ chạy lại toàn bộ test), mỗi lỗi một nhánh nhỏ.
- `scripts/reset-demo.sh`: đưa dữ liệu demo về trạng thái ban đầu (phối hợp seed của Vũ).
- **Diễn tập:** chạy `09-demo-script.md` ít nhất 2 lần trên môi trường thật, có người đóng vai phản biện (prompt "Đóng vai hội đồng"); quay video dự phòng; chuẩn bị phương án B: dùng `MockAdapter` nếu cổng thanh toán hoặc mạng gặp sự cố.
- **Ngân hàng câu hỏi bảo vệ:** từ `docs/learning/defense-notes.md`, ADR và báo cáo đo, tổng hợp 30 câu hỏi khó nhất kèm câu trả lời ngắn có dẫn chứng.

---

## 5. Cổng (Gate) và định nghĩa xong

| Cổng             | Điều kiện                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** (cuối T2) | k6 S1: oversell = 0; Lua + unique index hoạt động; rehydrate đúng; có báo cáo baseline                                                                                                    |
| **G2** (cuối T3) | Chọn ghế → (Waiting Room nếu đã xong) → checkout → thanh toán (VNPay sandbox hoặc Mock) → `OrderConfirmed` → vé phát hành; IPN trùng và order hết hạn không làm mất ghế/trùng vé          |
| **G3** (cuối T5) | Mọi mục **[M]** và **[S]** của tuần 1–5 xong; có `loadtest-1`, `loadtest-2`, `chaos-s4`, `zap`, `hardening-checklist`; staging tự deploy; mục **[C]** chưa làm đã ghi vào hạn chế đã biết |
| **G4** (giữa T6) | Chạy ổn trên domain thật; restore đã diễn tập; `docs/final/` đầy đủ; đã tập dượt lần 1                                                                                                    |

## 6. Việc của Sơn/Vũ ảnh hưởng đến Tuấn (và đường dự phòng)

| Việc                                              | Người | Tuấn cần khi | Nếu chưa có                                           |
| ------------------------------------------------- | ----- | ------------ | ----------------------------------------------------- |
| S-203 `EventApproved`                             | Sơn   | T-203        | `scripts/publish-fake-event.ts`                       |
| S-206 `seat-classes`                              | Sơn   | T-203b       | Server giả + `seed-seat-pricing.ts`                   |
| S-301 Ticket consume `OrderConfirmed`             | Sơn   | G2, T-403    | Kiểm tra bằng `revenue_records`, bỏ so khớp `tickets` |
| S-405 Resale mua (+ `ResaleOrderAwaitingPayment`) | Sơn   | T-405        | Server giả phát sự kiện; hoãn T-405                   |
| S-505 Hóa đơn (dùng bảng `invoices` của T-402)    | Sơn   | G3           | Cắt theo đường cắt giảm                               |
| V-305 Merch consume `OrderCreated/OrderConfirmed` | Vũ    | G2           | Chạy bằng merch giả                                   |
| V-306 `quotes`                                    | Vũ    | T-301        | Server giả theo `merch-quotes.yaml`                   |
| V-501 Admin portal (refund, audit, DLQ)           | Vũ    | T-401, T-402 | Dùng Swagger/Kafka UI cho demo                        |
| V-502 Dashboard Organizer                         | Vũ    | T-402        | Polling REST thay SSE                                 |

## 7. Khi tiến độ trễ — thứ tự cắt (Tuấn)

1. **[C]** của T-402 (SSE thống kê) → polling REST.
2. **[S]** của T-402 (audit hash-chain, DLQ admin) → để tuần 5/6 hoặc ghi vào hạn chế.
3. T-405 (nếu Sơn chưa có S-405).
4. **[C]** của T-501 (trace qua Kafka, Kong OpenTelemetry), rồi Jaeger.
5. Soak test của T-504.
6. T-404 dời sang đầu tuần 5.

**Không được cắt:** Lua + unique index, saga/outbox/inbox, hoàn tiền đúng một lần, sổ cái cân bằng, load test + báo cáo, chaos test cơ bản (kịch bản 1–4), restore diễn tập, deploy.
