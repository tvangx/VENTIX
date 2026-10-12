# Prompt giao việc cho agent (đã điền sẵn)

Cách dùng: mở **phiên chat mới** → dán **đúng một khối** bên dưới → đọc bản tóm tắt 10 dòng → nói **OK** hoặc **Sửa: ...**.
Thứ tự và cách duyệt: `START_HERE.md` và `docs/dev/operating-guide.md`. Mọi prompt đã trỏ tới `AGENTS.md` (quy trình bắt buộc), nên không cần dán thêm quy tắc.

| Task                                      | Tuần | Cần 2 người đọc | Ghi chú                           |
| ----------------------------------------- | ---- | --------------- | --------------------------------- |
| [T-102](#t-102-template-service)          | 1    | auth-guard      | Làm đầu tiên                      |
| [T-103](#t-103-outbox-inbox)              | 1    | Có              | Mã lõi                            |
| [T-201](#t-201-schema-booking_db)         | 1    | Có              | Unique index                      |
| [T-207](#t-207-vps-compose-prod)          | 1    | Không           | Agent chỉ viết file, bạn thuê VPS |
| [T-202](#t-202-lua-giữ-ghế)               | 2    | Có              | Mã lõi                            |
| [T-206](#t-206-kong)                      | 2    | Không           |                                   |
| [T-203](#t-203-consumer-event--rehydrate) | 2    | Không           |                                   |
| [T-204](#t-204-seat-status--sse--sweeper) | 2    | Không           |                                   |
| [T-205](#t-205-k6-s1)                     | 2    | Không           | Cổng G1                           |
| [T-203b](#t-203b-prefetch-seat_pricing)   | 2    | Không           | Chờ S-206 hoặc dùng server giả    |
| [T-301](#t-301-checkout)                  | 3    | Có              | Mã lõi                            |
| [T-302](#t-302-payment--adapter)          | 3    | Không           | Cần VNPay sandbox cho E2E         |
| [T-303](#t-303-ipn--sweeper--bù-trừ)      | 3    | Có              | Mã lõi                            |
| [T-304](#t-304-waiting-room)              | 3    | Không           | Cổng G2                           |

Prompt dùng chung (mở rộng đặc tả tuần 4–6, sửa theo review, chế độ lô, smoke test, reviewer, giải thích) nằm ở **cuối file**.

> T-301a (hợp đồng saga) **đã được cài đặt sẵn**, không có prompt cho agent.

---

## T-102 Template service

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0003-kong-gateway.md, docs/adr/0004-jwt-verification.md.

NHIỆM VỤ: task <built-in function id> "Template NestJS service" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/template-t102-service-template
Phụ thuộc phải là Done: T-101 (đã Done).

MỤC TIÊU: Sơn và Vũ tạo service mới trong dưới 1 giờ, đã có health, log JSON, xác thực JWT, lỗi chuẩn, OpenAPI, Prisma, test mẫu.

CẦN LÀM / LƯU Ý:
- packages/common: createLogger(pino), RequestIdMiddleware, ProblemException + ProblemJsonFilter (RFC 7807), loadEnv(zod).
- packages/auth-guard: JwtAuthGuard dùng jose, CHỈ RS256, kiểm tra iss/aud/exp; khóa từ AUTH_JWKS_URI (cache, làm mới khi gặp kid lạ, có cooldown) hoặc AUTH_PUBLIC_KEY_PEM (chỉ dev/test); @Public(), @Roles(), RolesGuard, @CurrentUser() trả {userId, roles, organizerId?}.
- services/_template (@ticketing/service-template): main.ts, config/env.schema.ts, /health/live + /health/ready (kiểm tra DB), /metrics, OpenTelemetry (chỉ bật khi có OTEL_EXPORTER_OTLP_ENDPOINT), Prisma (chưa có model), Dockerfile nhiều tầng, Jest + 1 test unit + 1 test integration Testcontainers, script openapi:export.
- scripts/new-service.sh <name> <port> [--force-name]: sao chép template, thay __SERVICE__/__PORT__/tên package, tạo .env.example với DATABASE_URL=postgresql://<name>_user:<name>_dev@localhost:5432/<name>_db. Mặc định chỉ nhận 9 tên service (+ ai).
- Thêm scope common, auth-guard, template, loadtest vào commitlint.config.cjs. Viết docs/dev/new-service.md.
- Máy tôi chạy Windows (Git Bash/WSL): script shell dùng LF, chạy được trên bash.
- Không dùng Passport. Không đọc process.env ngoài loadEnv.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
- pnpm --filter @ticketing/common test và pnpm --filter @ticketing/auth-guard test (token sai chữ ký, hết hạn, alg khác RS256, không token => 401).
- bash scripts/new-service.sh demo 3099 --force-name; pnpm --filter @ticketing/demo dev; GET :3099/health/ready = 200 khi make up đang chạy; chạy test và test:int của demo; rồi XÓA service demo.
- Toàn repo: pnpm format:check && pnpm build && pnpm lint && pnpm typecheck && pnpm test.

Ràng buộc chung:
- Chỉ làm task T-102. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-102.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-103 outbox-inbox

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0005-saga-outbox-inbox.md, packages/event-contracts/ (README và src), packages/outbox-inbox/ (README, sql).

NHIỆM VỤ: task <built-in function id> "Thư viện Outbox + Inbox" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/outbox-t103-outbox-inbox-lib
Phụ thuộc phải là Done: T-102.

MỤC TIÊU: Thư viện Transactional Outbox + Inbox dùng chung cho mọi service (ADR-0005).

CẦN LÀM / LƯU Ý:
- SqlExecutor { query<T>(sql, params?) } + adapter fromPrismaTx(tx) và fromPgClient(client); thư viện KHÔNG phụ thuộc cứng vào Prisma.
- OutboxService.add(exec, message): validate bằng parseMessage, topic lấy từ topicOf, ghi outbox_events cùng transaction của caller.
- OutboxRelay: polling (pollIntervalMs, batchSize), trong 1 transaction SELECT ... WHERE published_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT n -> gửi Kafka (kafkajs, idempotent: true, acks: -1) -> UPDATE published_at; start()/stop() graceful; metric gửi/lỗi/độ trễ.
- createInboxConsumer({groupId, consumerName, topics, db, handler}): parseMessage -> trong 1 transaction INSERT processed_events ON CONFLICT DO NOTHING (0 dòng => bỏ qua) -> handler(exec, message) -> commit offset. Sai schema => DLQ ngay. Lỗi tạm thời => retry backoff + jitter (maxAttempts); quá hạn => <topic>.dlq kèm header x-error, x-attempts, x-original-topic.
- Đổi newMessage trong event-contracts sang UUIDv7 (gói uuidv7, nêu lý do trong PR). Đây là chi tiết cài đặt, không phải thay đổi hợp đồng; không đụng schema.
- README có ví dụ dùng trong 15 dòng.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Testcontainers (Postgres + Kafka hoặc Redpanda), cần Docker:
1. Ghi nghiệp vụ + outbox cùng transaction; rollback => không có sự kiện.
2. Relay chết giữa lúc publish rồi chạy lại => không mất; có thể trùng nhưng consumer chỉ xử lý 1 lần.
3. Hai relay chạy song song => không gửi cùng một dòng hai lần.
4. Message sai schema => DLQ; handler lỗi tạm thời 2 lần rồi thành công => xử lý đúng 1 lần.
5. Thứ tự trong cùng key được giữ.
Rồi pnpm --filter @ticketing/outbox-inbox lint typecheck test và pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-103. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-103.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.
- Đây là mã lõi: ghi vào PR mục 'Cần 2 người đọc'.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-201 Schema booking_db

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0001, 0002, 0009, 0010, docs/architecture/architecture-v2.md (mục 5.3), packages/outbox-inbox/sql/outbox_inbox.sql.

NHIỆM VỤ: task <built-in function id> "Schema booking_db" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/booking-t201-schema
Phụ thuộc phải là Done: T-102, T-103.

MỤC TIÊU: Dựng services/booking và schema booking_db có các ràng buộc do DATABASE bảo đảm.

CẦN LÀM / LƯU Ý:
- bash scripts/new-service.sh booking 3003; Prisma schema; prisma migrate dev --create-only rồi SỬA TAY file SQL.
- Bảng: orders, order_items, seat_allocations, ticket_class_stock, event_snapshots (+event_version, seat_map_version, pricing_ready), seat_pricing, vouchers, voucher_redemptions, idempotency_keys, outbox_events, processed_events.
- SQL tay bắt buộc: dùng ĐÚNG khối SQL trong TUAN_PLAN.md mục T-201 (uq_seat_active, các CHECK gồm REFUND_REQUIRED và item_type không có COMBO, các index, ck_stock_range).
- Kết nối bằng booking_user (không dùng postgres). Chưa viết Lua, chưa viết API.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Integration (Testcontainers Postgres): chèn 2 allocation HELD cùng ghế => lần 2 lỗi 23505; chuyển cái đầu sang RELEASED rồi chèn lại được; sold vượt total => vi phạm CHECK; item_type='COMBO' => vi phạm CHECK; status lạ => vi phạm CHECK; migration chạy từ DB rỗng.
Rồi pnpm --filter @ticketing/booking lint typecheck test test:int và pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-201. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-201.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.
- Mã lõi (unique index): ghi vào PR mục 'Cần 2 người đọc'. Không sửa migration cũ nào.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-207 VPS compose prod

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0008-deploy-product-level.md, infra/compose/docker-compose.yml.

NHIỆM VỤ: task <built-in function id> "Chuẩn bị deploy thử lên VPS (chỉ file và tài liệu)" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: chore/infra-t207-prod-compose
Phụ thuộc phải là Done: (không có).

MỤC TIÊU: Có sẵn file để tôi dựng VPS và deploy thử hạ tầng; agent KHÔNG thao tác trên VPS.

CẦN LÀM / LƯU Ý:
- infra/compose/docker-compose.prod.yml: hạ tầng (Postgres, Redis, Kafka, MinIO, Kong), restart: unless-stopped, mạng nội bộ, CHỈ Kong mở cổng ra ngoài, không bind 5432/6379/9092 ra host. Service nghiệp vụ để dạng khối chú thích sẵn (chưa có image).
- infra/deploy/deploy.sh (pull, up -d, kiểm tra sức khỏe), docs/ops/vps-setup.md (cài Docker, tạo user deploy, firewall, Cloudflare, nơi đặt .env.prod).
- KHÔNG đặt mật khẩu mặc định vào file prod; đọc từ .env.prod nằm ngoài git (thêm vào .gitignore); thêm .env.prod.example.
- Việc của Tuấn (agent chỉ liệt kê trong báo cáo): thuê VPS, domain, secrets.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
docker compose -f infra/compose/docker-compose.prod.yml config (không lỗi; nếu không có Docker thì nói rõ), bash -n infra/deploy/deploy.sh, pnpm format:check.

Ràng buộc chung:
- Chỉ làm task T-207. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-207.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-202 Lua giữ ghế

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0002-oversell-defense.md, services/booking (từ T-201).

NHIỆM VỤ: task <built-in function id> "Lua giữ ghế và POST /v1/holds" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/booking-t202-lua-hold-seats
Phụ thuộc phải là Done: T-201.

MỤC TIÊU: Giữ nhiều ghế all-or-nothing, atomic, có giới hạn và TTL (ADR-0002).

CẦN LÀM / LƯU Ý:
- Key (mọi key dùng hash tag {evt:<eventId>}): seat:{evt:E}:<seatId> = "H:<userId>" (có TTL) hoặc "S"; hold:{evt:E}:<userId> (Set); hexp:{evt:E} (ZSET score = hết hạn ms); sold:{evt:E} (Set); delta:{evt:E} (Pub/Sub H:/A:/S:<seatId>); holdlog:{evt:E} (Stream, CHỈ khi HOLDLOG_ENABLED=true).
- src/seat-hold/lua/hold_seats.lua + release_seats.lua (file .lua riêng, nạp bằng ioredis defineCommand). hold_seats: KEYS[1]=hold set, KEYS[2..]=seat keys; ARGV = holderTag, ttlSec, maxSeats, nowMs, các seatId. (1) ghế có giá trị khác holderTag => trả {0, seatKey}, KHÔNG ghi gì; (2) SCARD+số mới > maxSeats => {2}; (3) ghi tất cả (SET EX, SADD, ZADD, EXPIRE, PUBLISH) => {1}. Giữ lại ghế mình đã giữ là idempotent và gia hạn TTL. release_seats chỉ DEL khi giá trị == holderTag.
- API: POST /v1/holds {event_id, seat_ids[]} => 201 {expires_at, seat_ids} | 409 SEAT_UNAVAILABLE {seat_id} | 422 HOLD_LIMIT_EXCEEDED; DELETE /v1/holds; GET /v1/holds?event_id=. userId lấy từ JWT. Env: HOLD_TTL_SECONDS=600, HOLD_MAX_SEATS=6, ADMISSION_REQUIRED=false (mặc định đến khi có T-304), HOLDLOG_ENABLED=false.
- Chỉ cho giữ khi event_snapshots cho phép bán và trong sale_window và pricing_ready=true; nếu chưa có snapshot => 404 EVENT_NOT_ON_SALE, chưa pricing_ready => 503 EVENT_NOT_READY + Retry-After. Trong test dùng snapshot dựng sẵn.
- Không dùng KEYS/SCAN. README ghi rõ: hold chỉ nằm ở Redis, mất Redis thì user giữ lại (chấp nhận).

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
test:conc và test:int (Testcontainers Redis, cần Docker):
1. 100 người SONG SONG tranh cùng 1 ghế => đúng 1 thành công.
2. Giữ [A,B,C] khi B đã bị người khác giữ => thất bại và A, C KHÔNG bị ghi.
3. Vượt HOLD_MAX_SEATS => 422, không ghi gì.
4. Release chỉ có hiệu lực với chủ hold; TTL hết => giữ lại được.
5. Giữ lặp lại cùng ghế bởi cùng user => 201 và TTL được gia hạn.
Rồi pnpm --filter @ticketing/booking lint typecheck test test:int test:conc và pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-202. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-202.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.
- Mã lõi: ghi vào PR mục 'Cần 2 người đọc'.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-206 Kong

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0003, 0004, 0010, infra/kong/kong.yml.

NHIỆM VỤ: task <built-in function id> "Hoàn thiện Kong (rate limit riêng + chặn /internal)" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/infra-t206-kong-hardening
Phụ thuộc phải là Done: T-104 (Done), T-202.

MỤC TIÊU: Kong có rate limit riêng cho đường nóng và chặn mọi đường /internal từ bên ngoài.

CẦN LÀM / LƯU Ý:
- Rate limit riêng cho /api/booking/v1/holds, /checkout, /queue/join (giá trị đề xuất trong PR, cấu hình được).
- Chặn /api/<service>/v1/internal* bằng route + plugin request-termination trả 404. KIỂM TRA thứ tự ưu tiên route của Kong 3.8 bằng curl thật, không đoán.
- infra/kong/kong.loadtest.yml (giới hạn nới) + make kong-loadtest. JWT KHÔNG verify ở Kong (ADR-0004).
- scripts/check-kong.sh: kiểm tra CORS preflight, 429 khi vượt, X-Request-Id được trả về, /api/event/v1/internal/events/x/seat-classes => 404 từ Kong; thoát mã khác 0 nếu sai.
- Máy tôi chạy Git Bash: tự đặt MSYS_NO_PATHCONV=1 trong script nếu có docker exec với đường dẫn tuyệt đối.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
make up rồi make kong-reload rồi bash scripts/check-kong.sh (phải thoát 0), pnpm format:check. Nếu không có Docker, nói rõ và liệt kê lệnh tôi cần chạy.

Ràng buộc chung:
- Chỉ làm task T-206. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-206.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-203 Consumer event + rehydrate

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0005, 0006, packages/event-contracts/, packages/outbox-inbox/.

NHIỆM VỤ: task <built-in function id> "Consumer event.lifecycle và rehydrate Redis" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/booking-t203-event-consumer-rehydrate
Phụ thuộc phải là Done: T-103, T-201 (S-203 của Sơn có thể chưa xong).

MỤC TIÊU: event_snapshots luôn đúng phiên bản mới nhất; Redis khôi phục được từ PostgreSQL.

CẦN LÀM / LƯU Ý:
- Dùng createInboxConsumer xử lý EventApproved/EventUpdated/EventCancelled => upsert event_snapshots CHỈ khi event_version mới hơn: INSERT ... ON CONFLICT (event_id) DO UPDATE ... WHERE event_snapshots.event_version < EXCLUDED.event_version. Khởi tạo ticket_class_stock.total từ ticket_classes (không bao giờ giảm dưới sold). EventCancelled => không cho bán. Ghi seat_map_version; KHÔNG tự đặt pricing_ready=true (việc của T-203b).
- Rehydrate khi khởi động, TRƯỚC khi /health/ready = 200, có cờ tắt: SOLD => seat:...="S" + sold:{evt}; HELD của order còn hạn => "H:<userId>" với TTL còn lại; dùng SET ... NX để không đè dữ liệu mới.
- Nếu S-203 của Sơn chưa có: viết scripts/publish-fake-event.ts phát EventApproved bằng newMessage lên event.lifecycle để dev/test. Không sửa services/event.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Gửi sự kiện cũ sau sự kiện mới => bị bỏ qua; gửi trùng => xử lý 1 lần; FLUSHALL Redis rồi khởi động lại => trạng thái ghế khớp DB.
Rồi pnpm --filter @ticketing/booking lint typecheck test test:int và pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-203. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-203.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-204 Seat status + SSE + sweeper

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, services/booking (T-202).

NHIỆM VỤ: task <built-in function id> "Trạng thái ghế realtime, SSE và sweeper hết hạn hold" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/booking-t204-seat-status-sse
Phụ thuộc phải là Done: T-202.

MỤC TIÊU: Client thấy trạng thái ghế gần realtime mà không gây bão băng thông.

CẦN LÀM / LƯU Ý:
- GET /v1/events/:id/seat-status => {sold:[...], held:[...], as_of} từ sold:{evt} và ZRANGEBYSCORE hexp now +inf (không SCAN).
- Delta publisher: subscribe delta:{evt:*}, gộp lô 500 ms, đẩy qua SSE GET /v1/events/:id/seat-stream (có event: snapshot khi mới kết nối).
- Sweeper hết hạn hold mỗi 1 giây: ZRANGEBYSCORE hexp -inf now => ZREM + PUBLISH A:<seatId> (TTL tự xóa key ghế, sweeper chỉ lo thông báo); nhiều replica an toàn bằng cách chỉ bên ZREM thành công mới thông báo.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Giữ ghế => client SSE nhận H trong <= 1 giây; hết TTL => nhận A; 2 replica không phát trùng thông báo hết hạn.
Rồi pnpm --filter @ticketing/booking lint typecheck test test:int test:conc và pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-204. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-204.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-205 k6 S1

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0002, services/booking.

NHIỆM VỤ: task <built-in function id> "Load test S1 tranh ghế và script kiểm tra oversell" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/loadtest-t205-s1-seat-contention
Phụ thuộc phải là Done: T-202.

MỤC TIÊU: Có bằng chứng đo được rằng không oversell dưới tải (Cổng G1).

CẦN LÀM / LƯU Ý:
- infra/k6/s1-seat-contention.js, infra/k6/lib/auth.js; scripts/mint-test-tokens.ts (sinh N JWT RS256 bằng cặp khóa dev; booking chạy với AUTH_PUBLIC_KEY_PEM); scripts/verify-oversell.sh; docs/test-reports/s1-baseline.md.
- Kịch bản: USERS (5.000-10.000) VU, SEATS (2.000) ghế, mỗi VU thử giữ ghế ngẫu nhiên; biến BASE_URL, EVENT_ID.
- Chạy booking với HOLDLOG_ENABLED=true, HOLD_TTL_SECONDS=3600. Verifier đọc stream holdlog:{evt} và khẳng định: mỗi ghế TỐI ĐA 1 lần giữ thành công; tổng thành công == số ghế đang bị giữ trong Redis.
- Báo cáo: cấu hình máy, số replica, RPS, p50/p95/p99, tỷ lệ 409/5xx, kết quả verifier, nút cổ chai. GHI ĐÚNG SỐ ĐO THỰC TẾ; nếu k6 chưa chạy được thì ghi "chưa đo" và liệt kê lệnh tôi cần chạy. Ghi rõ nếu k6 chạy cùng máy với hệ thống.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Verifier phải thoát 0 sau khi chạy; chạy thử verifier với dữ liệu giả cố ý có 1 ghế bị giữ 2 lần để chứng minh nó báo lỗi.

Ràng buộc chung:
- Chỉ làm task T-205. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-205.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-203b Prefetch seat_pricing

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0010-internal-sync-apis.md, docs/api/internal/seat-classes.yaml.

NHIỆM VỤ: task <built-in function id> "Prefetch seat_pricing từ event-service" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/booking-t203b-seat-pricing-prefetch
Phụ thuộc phải là Done: T-203 (S-206 của Sơn có thể chưa xong).

MỤC TIÊU: booking có sẵn ánh xạ ghế->hạng vé cục bộ để tính giá mà không gọi service khác khi khách đặt vé.

CẦN LÀM / LƯU Ý:
- EventSeatClassesClient gọi GET {EVENT_INTERNAL_URL}/v1/internal/events/{id}/seat-classes theo docs/api/internal/seat-classes.yaml: X-Internal-Key = INTERNAL_API_KEY, phân trang cursor, limit 1000, timeout + retry backoff.
- Job chạy khi EventApproved/Updated có seat_map_version MỚI hơn bản đã nạp: nạp từng trang, upsert theo lô (INSERT ... ON CONFLICT (event_id, seat_id) DO UPDATE), hoàn tất toàn bộ mới đặt pricing_ready=true TRONG MỘT transaction. Idempotent.
- Chưa pricing_ready => /holds và /checkout trả 503 EVENT_NOT_READY + Retry-After.
- Chưa có S-206: định nghĩa interface client, viết client thật + test với server HTTP giả dựng theo file OpenAPI; script scripts/seed-seat-pricing.ts cho dev. KHÔNG sửa services/event.
- Biến mới (env.schema.ts và .env.example): EVENT_INTERNAL_URL, INTERNAL_API_KEY.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
10.000 ghế qua nhiều trang đều vào bảng; ngắt giữa chừng rồi chạy lại => đủ dữ liệu, không trùng; pricing_ready chỉ true khi đủ; seat map phiên bản cũ không ghi đè phiên bản mới.
Rồi pnpm --filter @ticketing/booking lint typecheck test test:int và pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-203b. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-203b.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-301 Checkout

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0002, 0005, 0006, 0009, 0010, docs/api/internal/*.yaml, services/booking.

NHIỆM VỤ: task <built-in function id> "Checkout API" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/booking-t301-checkout
Phụ thuộc phải là Done: T-202, T-301a (đã commit), T-203b (hoặc dùng seed script).

MỤC TIÊU: Biến các hold hợp lệ thành order, giá do server tính, an toàn khi gọi lặp và khi tranh ghế.

CẦN LÀM / LƯU Ý:
POST /v1/checkout, header Idempotency-Key BẮT BUỘC. Body: { event_id, seat_ids[], ga_items[{ticket_class_id, quantity}], merch_items[{sku_id, quantity}], voucher_code? }. voucher_code có giá trị => 422 VOUCHER_NOT_SUPPORTED. Combo chưa có trong body.
Luồng:
1. Admission khi ADMISSION_REQUIRED=true (guard có sẵn hoặc cờ tắt; KHÔNG tự viết Waiting Room, đó là T-304).
2. event_snapshots: đang bán, trong sale_window, pricing_ready=true; không đạt => 409 EVENT_NOT_ON_SALE hoặc 503 EVENT_NOT_READY + Retry-After.
3. Tính giá, KHÔNG tin client: ghế từ seat_pricing + event_snapshots.ticket_classes; GA từ event_snapshots; merch qua MerchQuoteClient CHỈ KHI có merch_items.
4. Xác minh hold thuộc user bằng Lua (thiếu => 409 HOLD_NOT_FOUND), gia hạn 1 lần lên ORDER_PAYMENT_WINDOW_SECONDS (900).
5. TRANSACTION: orders(PENDING, expires_at = now + window), order_items (chỉ TICKET_SEAT/TICKET_GA/MERCH), seat_allocations(HELD), trừ ticket_class_stock bằng UPDATE ... WHERE sold + :q <= total, outbox OrderCreated; KHÔNG có merch => chuyển luôn AWAITING_PAYMENT và outbox OrderAwaitingPayment trong cùng transaction. Vi phạm uq_seat_active => rollback, nhả hold, 409 SEAT_UNAVAILABLE.
6. Có merch: chờ StockReserved => AWAITING_PAYMENT + OrderAwaitingPayment; StockRejected => CANCELLED(STOCK_REJECTED) + nhả ghế/GA.
Idempotency: cùng key + cùng request_hash => trả lại kết quả cũ; khác hash => 422 IDEMPOTENCY_KEY_REUSED (bảng idempotency_keys).
MerchQuoteClient (src/clients/merch-quote.client.ts): MERCH_INTERNAL_URL, X-Internal-Key, timeout 800ms, 1 retry, circuit breaker (opossum). Lỗi/mạch mở => 503 MERCH_UNAVAILABLE CHỈ cho order có merch; order chỉ có vé KHÔNG bị ảnh hưởng (có test). merch-service chưa tồn tại: định nghĩa MerchQuotePort, viết client thật + test với server HTTP giả theo docs/api/internal/merch-quotes.yaml. Không sửa services/merch.
State machine src/orders/order-state.ts đúng bảng ADR-0009; transition(id, from, to, expectedVersion) dùng UPDATE ... WHERE id AND status=:from AND version=:v, kiểm tra số dòng.
Biến mới (env.schema.ts và .env.example): ORDER_PAYMENT_WINDOW_SECONDS, ORDER_EXPIRY_GRACE_SECONDS (30), MERCH_INTERNAL_URL, INTERNAL_API_KEY, MERCH_QUOTE_TIMEOUT_MS.
NGOÀI PHẠM VI: consumer PaymentSucceeded/Failed, sweeper hết hạn, Lua sell_seats (T-303), Waiting Room (T-304), voucher, combo, payment-service. Không đụng services/merch, services/event, services/ticket.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
test:int và test:conc:
- 20 checkout SONG SONG cùng Idempotency-Key => đúng 1 order.
- 2 user cùng ghế => đúng 1 thắng; bên thua nhận 409 SEAT_UNAVAILABLE và hold của họ được nhả.
- Rollback transaction => không có dòng outbox.
- Chuyển trạng thái sai thứ tự bị từ chối; chuyển song song cùng version => chỉ 1 thành công.
- Merch giả timeout/mở mạch => order chỉ có vé vẫn thành công, order có merch nhận 503.
- ticket_amount + merch_amount == total_amount; item_type không bao giờ là COMBO.
Lệnh: pnpm --filter @ticketing/booking lint typecheck test test:int test:conc, rồi pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-301. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-301.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.
- Mã lõi (unique index, transaction, state machine, idempotency): ghi vào PR mục 'Cần 2 người đọc'.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-302 Payment + adapter

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0009-post-payment-flow.md, docs/adr/0005, packages/event-contracts/, tài liệu sandbox chính thức của VNPay.

NHIỆM VỤ: task <built-in function id> "payment-service, VnpayAdapter và MockAdapter" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/payment-t302-adapters
Phụ thuộc phải là Done: T-103, T-301a.

MỤC TIÊU: payment-service tạo thanh toán qua cổng thật (VNPay sandbox) hoặc mock, idempotent.

CẦN LÀM / LƯU Ý:
- Tạo service: bash scripts/new-service.sh payment 3004; payment_db theo ERD 5.4 (đã có payable_orders ở architecture-v2.md); consumer OrderAwaitingPayment => payable_orders.
- POST /v1/payments {order_id, provider} + Idempotency-Key: kiểm tra order còn hạn; read-model chưa có => 409 ORDER_NOT_READY + Retry-After: 1; mỗi order tối đa 1 payment đang hoạt động (PENDING hoặc SUCCEEDED), ĐƯỢC tạo payment mới sau khi payment trước FAILED (ADR-0009 D7); trả {redirect_url}. vnp_ExpireDate = payable_orders.expires_at.
- interface IPaymentAdapter { createPayment(); verifyReturn(); verifyIpn(); refund(); }.
- MockAdapter: URL giả; sau MOCK_DELAY_MS (ngẫu nhiên trong khoảng cấu hình) tự gọi IPN nội bộ với tỷ lệ thành công cấu hình; chế độ xác định cho test; cờ gửi IPN TRÙNG.
- VnpayAdapter: sinh URL, HMAC-SHA512 trên tham số sắp xếp theo thứ tự chữ cái, vnp_Amount nhân 100, giờ GMT+7, kiểm tra chữ ký IPN/Return. ĐỐI CHIẾU từng tham số, mã phản hồi IPN và cách mã hóa URL với tài liệu sandbox CHÍNH THỨC của VNPay; không dựa vào trí nhớ. Không truy cập được tài liệu => dừng và hỏi.
- Bí mật chỉ từ biến môi trường (VNPAY_TMN_CODE, VNPAY_HASH_SECRET, VNPAY_RETURN_URL, VNPAY_IPN_URL), không log, không commit; cập nhật .env.example (giá trị rỗng).
- Việc tôi tự làm: chạy E2E với VNPay sandbox thật (cần cloudflared).

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Unit cho ký/verify (vector tự tính độc lập); mock chạy xong luồng; tạo payment lần 2 sau FAILED được, lần 2 khi payment trước PENDING thì bị từ chối.
Rồi pnpm --filter @ticketing/payment lint typecheck test test:int và pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-302. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-302.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-303 IPN + sweeper + bù trừ

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0002, 0005, 0009, services/booking, services/payment.

NHIỆM VỤ: task <built-in function id> "IPN idempotent, consumer saga, sweeper hết hạn" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/booking-t303-saga-consumers
Phụ thuộc phải là Done: T-301, T-302.

MỤC TIÊU: Hoàn tất saga: thanh toán thành công => order CONFIRMED => OrderConfirmed; hết hạn/đến muộn xử lý đúng.

CẦN LÀM / LƯU Ý:
- IPN (payment): verify chữ ký + số tiền => TRANSACTION: INSERT payment_transactions ... ON CONFLICT (provider_txn_id) DO NOTHING; chèn được => cập nhật payments (điều kiện status='PENDING') + outbox PaymentSucceeded/Failed. Luôn trả đúng định dạng phản hồi nhà cung cấp, kể cả khi trùng.
- booking consumers (ADR-0009): PaymentSucceeded: AWAITING_PAYMENT => CONFIRMED, allocations HELD->SOLD, Lua sell_seats (SET S, SADD sold, dọn hold/hexp, PUBLISH S:), outbox OrderConfirmed đủ trường (items, tách tiền vé/merch, payment_id); order đã EXPIRED/FAILED/CANCELLED => REFUND_REQUIRED + outbox OrderCancelled{LATE_PAYMENT}; đã CONFIRMED (trùng) => bỏ qua. PaymentFailed: chỉ ghi nhận, KHÔNG hủy order (D7). StockRejected => CANCELLED(STOCK_REJECTED), nhả ghế/stock/GA. RefundCompleted => REFUNDED.
- Sweeper: status IN ('PENDING','AWAITING_PAYMENT') AND expires_at < now() - ORDER_EXPIRY_GRACE_SECONDS, FOR UPDATE SKIP LOCKED LIMIT 100 => EXPIRED, allocations RELEASED, Lua release, trả stock GA, outbox OrderExpired.
- Phần payment tự hoàn tiền khi thấy OrderCancelled{LATE_PAYMENT} thuộc T-401: T-303 chỉ cần phát đúng sự kiện.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Test các ca biên: IPN gửi 2-3 lần => xử lý 1 lần; PaymentSucceeded đến SAU khi order hết hạn => REFUND_REQUIRED + OrderCancelled{LATE_PAYMENT}; PaymentFailed rồi thanh toán lại thành công => CONFIRMED; IPN đến trước StockReserved; sweeper 2 replica => không xử lý đôi; PaymentSucceeded trùng/đảo thứ tự.
Rồi pnpm --filter @ticketing/booking --filter @ticketing/payment lint typecheck test test:int test:conc và pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-303. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-303.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.
- Mã lõi: ghi vào PR mục 'Cần 2 người đọc'. Chỉ sửa services/booking và services/payment.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-304 Waiting Room

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0002, 0004, services/booking.

NHIỆM VỤ: task <built-in function id> "Waiting Room" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/booking-t304-waiting-room
Phụ thuộc phải là Done: T-202, T-206.

MỤC TIÊU: Giới hạn lượng người vào đường đặt vé theo tốc độ cấu hình (Cổng G2; được phép trượt sang đầu tuần 4).

CẦN LÀM / LƯU Ý:
- POST /v1/queue/join {event_id} (idempotent: ZADD NX queue:{evt:E}); GET /v1/queue/status?event_id= (SSE: position = ZRANK, estimated_wait_sec, status).
- Admission worker: mỗi 1 giây lấy N người đầu hàng (N suy từ sale_phases.admit_rate; đọc từ event_snapshots), CHỈ MỘT replica chạy mỗi tick (khóa Redis SET NX PX), phát admission token (HS256, bí mật ADMISSION_TOKEN_SECRET, claim sub, evt, jti, exp 5-10 phút), lưu admitted:{evt:E} có TTL, có trần số người được admit đồng thời.
- AdmissionGuard bắt buộc cho /holds và /checkout khi queue_enabled; queue_enabled=false => bỏ qua; đặt ADMISSION_REQUIRED=true làm mặc định sau task này.
- Biến mới vào env.schema.ts và .env.example.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Tốc độ admit đúng cấu hình; 2 replica KHÔNG admit gấp đôi; token thiếu/hết hạn/sai sự kiện => 403 ADMISSION_REQUIRED; join lặp giữ nguyên vị trí.
Rồi pnpm --filter @ticketing/booking lint typecheck test test:int test:conc và pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-304. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Tạo docs/agent/runs/T-304.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

---

## Prompt dùng chung

### Mở rộng đặc tả (task tuần 4–6 chỉ có bản rút gọn)

```text
Đọc AGENTS.md và docs/agent/TUAN_PLAN.md. Task <T-xxx> mới có bản rút gọn.
CHƯA VIẾT CODE. Hãy đề xuất đặc tả chi tiết cho task này theo đúng khuôn của các task tuần 1–3 trong TUAN_PLAN.md:
Mục tiêu, Đầu ra (đường dẫn), Việc cần làm, Kiểm chứng (lệnh/tiêu chí), Ngoài phạm vi, Lưu ý.
Nêu rõ giả định, phụ thuộc, các điểm cần tôi quyết định. Ghi bản đề xuất vào docs/agent/runs/<T-xxx>-spec.md và dừng để tôi duyệt.
```

### Sửa theo review

```text
Đọc AGENTS.md mục 11 và docs/agent/runs/<T-xxx>.md. PR của task <T-xxx> có góp ý review sau:
<dán góp ý>
Sửa trên CÙNG nhánh, thêm commit mới (không force-push). Chạy lại kiểm chứng liên quan, thêm mục "Lần chạy 2" vào run report,
rồi báo cáo ngắn theo mẫu mục 10 và dừng.
```

### Chế độ lô (chỉ khi đã tin tưởng agent)

```text
Chế độ lô theo AGENTS.md mục 11: làm lần lượt <T-xxx>, <T-yyy>, <T-zzz>.
Mỗi task một nhánh, một PR, một run report; không gộp thay đổi. Dừng ngay khi gặp điều kiện dừng ở mục 9 hoặc khi một task
fail kiểm chứng mà bạn chưa sửa được. Task sau chỉ bắt đầu khi task trước đã mở PR và báo cáo xong. Cuối cùng tóm tắt cả lô trong một bảng.
```

### Smoke test (trước task đầu tiên)

```text
Đọc AGENTS.md. Không làm gì khác. Trả lời: (1) liệt kê 10 luật ở mục 0 bằng lời của bạn,
(2) nếu tôi bảo "làm T-202 và T-203 luôn đi" thì bạn làm gì, (3) khi nào bạn phải dừng và hỏi,
(4) bạn tạo file nào trước khi viết code.
```

### Reviewer (phiên riêng, không viết code)

```text
Bạn là reviewer khó tính, KHÔNG viết code. Đọc AGENTS.md mục 4 đến 7, rồi xem diff của nhánh <tên-nhánh> so với main
(git diff main). Đây là task <T-xxx>, đặc tả trong docs/agent/TUAN_PLAN.md.
Tìm: (1) race condition và chỗ kiểm-tra-rồi-ghi không atomic, (2) ca lỗi/trùng lặp chưa có test,
(3) chỗ lệch khỏi đặc tả hoặc ADR, (4) rủi ro bảo mật, (5) test yếu (test không thật sự kiểm tra điều nó tuyên bố).
Mỗi phát hiện ghi: file:dòng, mức độ (chặn/nên sửa/nhỏ), vì sao, gợi ý sửa. Cuối cùng đưa 3 ca test bổ sung đáng viết nhất.
Không khen, không tóm tắt lại diff.
```

### Giải thích, hội đồng, tự kiểm tra

```text
[Giải thích luồng] Giải thích luồng xử lý của <tính năng> cho người mới, từ request HTTP tới khi dữ liệu nằm trong DB và sự kiện lên Kafka.
Vẽ sequence bằng Mermaid, và với mỗi bước chỉ rõ file:dòng trong code. Dùng một ví dụ cụ thể có số liệu.
```

```text
[Giải thích điểm khó] Giải thích đoạn <file:dòng> như thể tôi chưa từng viết Redis/Lua. Nêu: nó làm gì, nếu bỏ nó đi thì lỗi nào xảy ra,
cho một kịch bản hai người dùng cùng lúc làm lộ ra lỗi đó.
```

```text
[Đóng vai hội đồng] Đóng vai giảng viên phản biện đồ án này. Dựa trên task <T-xxx> và docs/adr, đặt 5 câu hỏi khó nhất về thiết kế
(tính đúng đắn, hiệu năng, đánh đổi). Hỏi từng câu một, chờ tôi trả lời, rồi chấm điểm câu trả lời: đúng/thiếu/sai và vì sao.
```

```text
[Tự kiểm tra] Ra cho tôi 5 câu hỏi trắc nghiệm về những điểm dễ hiểu sai trong task <T-xxx> (race condition, idempotency, đánh đổi).
Không nêu đáp án; chờ tôi trả lời rồi giải thích.
```
