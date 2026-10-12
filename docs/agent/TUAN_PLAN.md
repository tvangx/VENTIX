# Kế hoạch việc của Tuấn — bản đặc tả cho agent

> Agent: đọc `AGENTS.md` trước. Mỗi lần chỉ làm **một** task theo Task Run Protocol. Trạng thái nằm ở `docs/agent/STATUS.md`.
> Tuấn phụ trách: hạ tầng · `packages/*` · `services/booking` · `services/payment` · `services/finance` · load test · giám sát · deploy.
> Nguồn: `docs/architecture/plan-6-weeks.md` (ID, ước lượng, phụ thuộc) — file này **bổ sung chi tiết kỹ thuật** để triển khai được.

## 1. Cách đọc một đặc tả

Mỗi task có: **Mục tiêu · Đầu ra (đường dẫn) · Việc cần làm · Kiểm chứng (lệnh/tiêu chí) · Ngoài phạm vi · Lưu ý**. Task của tuần 4–6 chỉ có bản rút gọn: **trước khi làm phải mở rộng đặc tả** (agent đề xuất bản chi tiết, Tuấn duyệt) rồi mới code.

## 2. Việc agent KHÔNG làm được (cần Tuấn tự làm)

| Việc                                                                 | Khi nào             | Agent hỗ trợ bằng cách                                                 |
| -------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------- |
| Đăng ký VNPay sandbox, lấy `vnp_TmnCode`/`vnp_HashSecret`            | Tuần 1              | Viết checklist, tạo `.env.example`; **không** nhập/ghi bí mật vào repo |
| Chạy `make up`/`make verify` trên máy Tuấn khi agent không có Docker | Mỗi lần đổi hạ tầng | Nêu rõ lệnh cần chạy trong báo cáo                                     |
| Thuê VPS, domain, cấu hình Cloudflare, secrets trên GitHub           | Tuần 2–6            | Viết script/compose/tài liệu từng bước                                 |
| Họp workshop T-107, quyết định chính sách nghiệp vụ                  | Tuần 1              | Soạn tài liệu chuẩn bị, ghi biên bản                                   |
| Bật branch protection, tạo Projects board                            | Phase 0             | Script `scripts/gh-bootstrap.sh` đã có                                 |

## 3. Quyết định hợp đồng đã chốt (ADR-0009, ADR-0010)

Các khoảng trống phát hiện khi rà saga **đã được chốt**. Agent không thay đổi các quyết định này; thấy mâu thuẫn thì dừng và hỏi.

| #      | Quyết định                                                         | Chi tiết                                                                                                               |
| ------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **C1** | Thêm `OrderAwaitingPayment`                                        | ADR-0009. Payment dựng `payable_orders`; chưa sẵn sàng thì `409 ORDER_NOT_READY` + `Retry-After: 1`                    |
| **C2** | Mở rộng `OrderConfirmed` (items, tách tiền vé/merch, `payment_id`) | ADR-0009. Ticket, merch (commit), finance, notification đều kích hoạt từ `OrderConfirmed`                              |
| **C3** | Thanh toán đến muộn ⇒ tự hoàn tiền                                 | ADR-0009. `REFUND_REQUIRED` → `OrderCancelled{LATE_PAYMENT}` → hoàn tiền → `REFUNDED`; `ORDER_EXPIRY_GRACE_SECONDS=30` |
| **C4** | Máy trạng thái order có `REFUND_REQUIRED`                          | ADR-0009 (bảng chuyển trạng thái)                                                                                      |
| **C5** | `seat_pricing` lấy bằng prefetch REST nội bộ                       | ADR-0010. Sơn: S-206; Tuấn: T-203b                                                                                     |
| **C6** | Báo giá merch đồng bộ, chỉ khi order có merch; combo để tuần 4     | ADR-0010. Vũ: V-306 (SKU lẻ), V-406 (combo)                                                                            |
| **D7** | `PaymentFailed` không hủy order                                    | ADR-0009                                                                                                               |

**T-301a (hợp đồng) đã được cài đặt sẵn** trong repo: `packages/event-contracts` (13 test), ADR-0009, ADR-0010, `docs/api/internal/*.yaml`. Tuấn chỉ cần review và commit; **không giao cho agent làm lại**.

Chưa hỗ trợ ở tuần 3: `voucher_code` (⇒ `422 VOUCHER_NOT_SUPPORTED`), combo (⇒ `422 COMBO_NOT_SUPPORTED`).

---

## 4. Thứ tự thực hiện (đường găng)

```
Tuần 1:  T-102 → T-301a (review/commit) → T-103 → T-201 ; T-105, T-207 ; T-106/T-107 do Tuấn
Tuần 2:  T-202 → T-206 → T-203 → T-204 → T-205 (→ Cổng G1) ; T-203b ngay khi Sơn xong S-206
Tuần 3:  T-301 → T-302 → T-303 → T-304 (→ Cổng G2; T-304 được phép trượt sang đầu tuần 4)
Tuần 4:  T-401 → T-402 → T-403 ; T-404 song song
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

## T-302 `payment-service` + adapter — 1,25 ngày — _cần: T-103, chốt C1; VNPay sandbox_

- Tạo service (`new-service.sh payment 3004`), `payment_db` theo ERD 5.4, read-model `payable_orders` (consume `OrderAwaitingPayment`).
- `POST /v1/payments {order_id, provider}` ⇒ kiểm tra order còn hạn & chưa thanh toán ⇒ tạo `payments(PENDING)` ⇒ trả `{redirect_url}`. Idempotent theo `Idempotency-Key`; mỗi order tối đa 1 payment đang hoạt động (`PENDING` hoặc `SUCCEEDED`), **được tạo payment mới sau khi payment trước `FAILED`** (D7). `vnp_ExpireDate` = `payable_orders.expires_at`. Read-model chưa có dữ liệu ⇒ `409 ORDER_NOT_READY` + `Retry-After: 1`.
- `interface IPaymentAdapter { createPayment(); verifyReturn(); verifyIpn(); refund(); }`.
- **`MockAdapter`:** trả URL giả; sau `MOCK_DELAY_MS` (ngẫu nhiên trong khoảng cấu hình) tự gọi IPN nội bộ với tỷ lệ thành công cấu hình; có chế độ xác định cho test; có cờ **gửi IPN trùng**.
- **`VnpayAdapter`:** sinh URL thanh toán, ký **HMAC-SHA512** trên tham số sắp xếp theo thứ tự chữ cái, `vnp_Amount` nhân 100, thời gian theo GMT+7, kiểm tra chữ ký IPN/Return. **Đối chiếu từng tham số, mã phản hồi IPN (ví dụ mã cho "đã xác nhận", "sai số tiền", "sai chữ ký") và cách mã hóa URL với tài liệu sandbox chính thức; không dựa vào trí nhớ. Không truy cập được tài liệu ⇒ dừng và hỏi.**
- Bí mật chỉ đọc từ biến môi trường (`VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET`, `VNPAY_RETURN_URL`, `VNPAY_IPN_URL`), không log.
- **Kiểm chứng:** unit cho ký/verify (có vector tự tính độc lập); mock chạy xong luồng; E2E thật với VNPay sandbox do **Tuấn** chạy (cần `cloudflared`).

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

# TUẦN 4 (rút gọn — mở rộng đặc tả trước khi làm)

| ID        | Mục tiêu                                               | Đầu ra chính                                                                                                                                                                     | Tiêu chí                                                                                            |
| --------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **T-401** | Refund đơn lẻ + hoàn lô (Admin) và auto-refund theo C3 | `services/payment` refund API, `refund_batches`, outbox `RefundCompleted`, consumer `OrderCancelled`                                                                             | Hủy sự kiện ⇒ hoàn lô; ghế/stock được nhả; hoàn tiền idempotent                                     |
| **T-402** | `finance-service` tối thiểu                            | Consumer `OrderConfirmed`/`RefundCompleted`; `ledger_entries` (INSERT-only, bút toán cân đối); `revenue_records` tách VAT vé/merch; `audit_logs` hash-chain; `event_sales_stats` | Tổng Nợ = tổng Có; sửa bản ghi cũ làm hỏng chuỗi hash và test phát hiện; trigger chặn UPDATE/DELETE |
| **T-403** | Load test vòng 1 (S1–S3, MockAdapter) + tối ưu         | `infra/k6/s2-*.js`, `s3-*.js`, `docs/test-reports/loadtest-1.md`                                                                                                                 | Bảng trước/sau tối ưu, oversell = 0, số vé = số order CONFIRMED                                     |
| **T-404** | Prometheus + Grafana cơ bản                            | `infra/compose` profile `obs`, dashboard RED                                                                                                                                     | p95, lỗi, RPS theo service                                                                          |

# TUẦN 5

| ID        | Mục tiêu                         | Đầu ra chính                                                                                                  | Tiêu chí                                              |
| --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **T-501** | Dashboard đầy đủ + Loki + Jaeger | Kafka lag, Redis, kết nối DB, log tập trung, tracing                                                          | Truy vết 1 order từ gateway đến ticket qua `trace_id` |
| **T-502** | Chaos test S4                    | Kịch bản dừng Redis/Kafka, payment trễ; báo cáo                                                               | Không mất đơn, không trùng vé, tự hồi phục            |
| **T-503** | Hardening                        | headers/CORS, tinh chỉnh rate limit, OWASP ZAP baseline, gitleaks pre-commit, xử lý lỗi Trivy, Docker secrets | ZAP không còn lỗi mức cao; không secret trong repo    |
| **T-504** | Load test vòng 2                 | `loadtest-2.md` so sánh vòng 1                                                                                | Có số liệu và nhận định                               |
| **T-505** | Pipeline deploy                  | Build/push image, deploy staging tự động, prod duyệt tay, smoke test                                          | Merge `main` ⇒ staging tự cập nhật                    |

# TUẦN 6

| ID        | Mục tiêu                                                                       | Tiêu chí                                          |
| --------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| **T-601** | Deploy production: domain, TLS, backup cron + **thử restore thật**, smoke test | Có biên bản restore thành công                    |
| **T-602** | Load/chaos lần cuối trên môi trường thật                                       | Báo cáo cuối kèm cấu hình máy và giới hạn đã biết |
| **T-603** | Tài liệu kiến trúc, concurrency, ADR, báo cáo hiệu năng                        | Khớp bản cuối                                     |
| **T-604** | Hỗ trợ sửa lỗi, tập dượt                                                       | —                                                 |

---

## 5. Định nghĩa Cổng (Gate) liên quan đến việc của Tuấn

| Cổng             | Điều kiện                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** (cuối T2) | k6 S1: oversell = 0; Lua + unique index hoạt động; rehydrate đúng                                                                                                 |
| **G2** (cuối T3) | Chọn ghế → (Waiting Room nếu đã xong) → checkout → thanh toán (VNPay sandbox hoặc Mock) → `OrderConfirmed`; IPN trùng và order hết hạn không làm mất ghế/trùng vé |
| **G3** (cuối T5) | Hoàn tất mọi mục Must + Should; có báo cáo chaos, ZAP, load test vòng 2                                                                                           |
