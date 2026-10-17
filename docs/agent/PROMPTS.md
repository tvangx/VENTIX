# Prompt giao việc cho agent (đã điền sẵn)

Cách dùng: mở **phiên chat mới** → dán **đúng một khối** bên dưới → đọc bản tóm tắt 10 dòng → nói **OK** hoặc **Sửa: ...**.
Thứ tự và cách duyệt: `START_HERE.md` và `docs/dev/operating-guide.md`. Mọi prompt đã trỏ tới `AGENTS.md` (quy trình bắt buộc), nên không cần dán thêm quy tắc.

| Task                                                | Tuần | Cần 2 người đọc | Ghi chú                           |
| --------------------------------------------------- | ---- | --------------- | --------------------------------- |
| [T-102](#t-102-template-service)                    | 1    | auth-guard      | Làm đầu tiên                      |
| [T-103](#t-103-outbox-inbox)                        | 1    | Có              | Mã lõi                            |
| [T-201](#t-201-schema-booking_db)                   | 1    | Có              | Unique index                      |
| [T-207](#t-207-vps-compose-prod)                    | 1    | Không           | Agent chỉ viết file, bạn thuê VPS |
| [T-202](#t-202-lua-giữ-ghế)                         | 2    | Có              | Mã lõi                            |
| [T-206](#t-206-kong)                                | 2    | Không           |                                   |
| [T-203](#t-203-consumer-event--rehydrate)           | 2    | Không           |                                   |
| [T-204](#t-204-seat-status--sse--sweeper)           | 2    | Không           |                                   |
| [T-205](#t-205-k6-s1)                               | 2    | Không           | Cổng G1                           |
| [T-203b](#t-203b-prefetch-seat_pricing)             | 2    | Không           | Chờ S-206 hoặc dùng server giả    |
| [T-301](#t-301-checkout)                            | 3    | Có              | Mã lõi                            |
| [T-302](#t-302-payment--adapter)                    | 3    | Không           | Cần VNPay sandbox cho E2E         |
| [T-303](#t-303-ipn--sweeper--bù-trừ)                | 3    | Có              | Mã lõi                            |
| [T-304](#t-304-waiting-room)                        | 3    | Không           | Cổng G2                           |
| [T-401](#t-401-refund-và-tự-hoàn-tiền)              | 4    | Có              | Tiền thật                         |
| [T-402](#t-402-finance-service)                     | 4    | Có              | Sổ cái, audit                     |
| [T-403](#t-403-load-test-vòng-1)                    | 4    | Không           | Cần số liệu thật                  |
| [T-404](#t-404-prometheus-và-grafana)               | 4    | Không           | Dời T5 nếu trễ                    |
| [T-405](#t-405-payment-cho-đơn-resale)              | 4    | Không           | Chờ S-405 hoặc server giả         |
| [T-501](#t-501-giám-sát-đầy-đủ)                     | 5    | Không           | Loki, exporters, Jaeger           |
| [T-502](#t-502-chaos-s4)                            | 5    | Không           | Tôi chạy kịch bản thật            |
| [T-503](#t-503-hardening-bảo-mật)                   | 5    | Không           | Bằng chứng bảo mật                |
| [T-504](#t-504-load-test-vòng-2)                    | 5    | Không           | Cần số liệu thật                  |
| [T-505](#t-505-pipeline-deploy)                     | 5    | Không           | Cổng G3                           |
| [T-601](#t-601-deploy-production)                   | 6    | Không           | Cần VPS, domain                   |
| [T-602](#t-602-load-test-cuối-trên-môi-trường-thật) | 6    | Không           | Cần số liệu thật                  |
| [T-603](#t-603-tài-liệu-cuối)                       | 6    | Không           | Mô tả đúng cái đã có              |
| [T-604](#t-604-sửa-lỗi-và-chuẩn-bị-bảo-vệ)          | 6    | Không           | Diễn tập                          |

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
- Tạo service: bash scripts/new-service.sh payment 3004; payment_db theo ERD 5.4 (đã cập nhật trong architecture-v2.md): payables, payments, payment_transactions, refund_batches, refunds, reconciliation_runs.
- payables(purpose, ref_id, user_id, event_id, amount_vnd, expires_at, status), khóa (purpose, ref_id): read-model dựng từ OrderAwaitingPayment (purpose=ORDER; đơn resale thêm ở T-405).
- POST /v1/payments {order_id, provider} + Idempotency-Key: kiểm tra payables còn hạn; chưa có => 409 ORDER_NOT_READY + Retry-After: 1; mỗi (purpose, ref_id) tối đa 1 payment đang hoạt động (PENDING hoặc SUCCEEDED), ĐƯỢC tạo payment mới sau khi payment trước FAILED (ADR-0009 D7); trả {redirect_url}. payments lưu purpose, ref_id, event_id (sao từ payables; T-401 cần). vnp_ExpireDate = payables.expires_at.
- interface IPaymentAdapter { createPayment(); verifyReturn(); verifyIpn(); refund(); }. (refund hoàn thiện ở T-401.)
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
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
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

## T-401 Refund và tự hoàn tiền

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0005, 0009, services/payment, services/booking, packages/outbox-inbox/.

NHIỆM VỤ: task <built-in function id> "Hoàn tiền đơn lẻ, hoàn lô và tự hoàn tiền" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/payment-t401-refunds
Phụ thuộc phải là Done: T-302, T-303.

MỤC TIÊU: Mọi khoản tiền đã thu mà không còn vé hợp lệ đều được hoàn đúng MỘT lần, kể cả khi sự cố xảy ra giữa chừng.

CẦN LÀM / LƯU Ý:
- [M] Consumer OrderCancelled{LATE_PAYMENT} => payment SUCCEEDED của order, chưa có refund => tạo refunds(PENDING).
- [M] payment consume EventCancelled => refund_batches(reason=EVENT_CANCELLED) + 1 refund cho MỌI payment SUCCEEDED có event_id đó và purpose=ORDER. booking consume EventCancelled => order PENDING/AWAITING_PAYMENT của sự kiện => CANCELLED(EVENT_CANCELLED), nhả hold/ghế/GA (chỉ sửa consumer này trong services/booking).
- [M] Worker: refunds PENDING bằng FOR UPDATE SKIP LOCKED; REFUND_CONCURRENCY (5), REFUND_RATE_PER_SEC; adapter.refund với khóa idempotent là refund.id; thành công => SUCCEEDED + outbox RefundCompleted CÙNG transaction; lỗi => attempts+1, next_attempt_at backoff lũy thừa + jitter; quá REFUND_MAX_ATTEMPTS (5) => NEEDS_MANUAL.
- [M] UNIQUE(payment_id) trên refunds; chuyển trạng thái bằng cập nhật có điều kiện.
- [M] API Admin (role ADMIN): POST /v1/admin/refunds {order_id, reason}; POST /v1/admin/refund-batches {event_id, reason}; GET /v1/admin/refund-batches/{id}; GET /v1/admin/refunds?status=; POST /v1/admin/refunds/{id}/retry (chỉ NEEDS_MANUAL). Mỗi hành động Admin phát AuditRecorded qua outbox.
- [M] MockAdapter.refund (tỷ lệ lỗi cấu hình, chế độ xác định) và VnpayAdapter.refund: ĐỐI CHIẾU tài liệu sandbox CHÍNH THỨC của VNPay (tham số, chữ ký, mã phản hồi); không truy cập được => dừng và hỏi. vnp_RequestId lấy từ refund.id.
- [S] Metric refunds_total{status}; log có refund_id, payment_id, batch_id.
- Ngoài phạm vi: hoàn một phần, hoàn tiền đơn resale, gửi email.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
1. OrderCancelled{LATE_PAYMENT} đến 3 lần => đúng 1 refund, 1 RefundCompleted.
2. EventCancelled với 500 payment SUCCEEDED => 500 refund; kill worker giữa chừng rồi chạy lại => không hoàn đôi, không bỏ sót.
3. Adapter lỗi tạm thời 2 lần rồi thành công => SUCCEEDED; lỗi mãi => NEEDS_MANUAL; retry thành công => SUCCEEDED.
4. Hai worker song song => mỗi refund chỉ một worker xử lý.
5. Không phải ADMIN => 403; có AuditRecorded cho mỗi hành động Admin.
6. Chuỗi: thanh toán muộn => REFUND_REQUIRED => hoàn tiền => RefundCompleted => REFUNDED.
Lệnh: pnpm --filter @ticketing/payment --filter @ticketing/booking lint typecheck test test:int test:conc, rồi pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-401. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-401.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.
- Mã lõi (hoàn tiền = tiền thật): ghi vào PR mục 'Cần 2 người đọc'. Chỉ sửa services/payment và consumer EventCancelled trong services/booking.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-402 finance-service

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0005, docs/architecture/architecture-v2.md (mục 5.9), packages/outbox-inbox/.

NHIỆM VỤ: task <built-in function id> "finance-service: sổ cái, VAT, audit, thống kê" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/finance-t402-ledger-audit
Phụ thuộc phải là Done: T-103, T-303.

MỤC TIÊU: Sổ cái bất biến, doanh thu tách vé/merch kèm VAT, audit log chống sửa, thống kê cho dashboard Organizer.

CẦN LÀM / LƯU Ý:
- bash scripts/new-service.sh finance 3009; finance_db theo ERD 5.9. Consumer (Inbox): OrderConfirmed, RefundCompleted, EventApproved/Updated (dựng events_ref(event_id, organizer_id, title)), AuditRecorded.
- [M] ledger_entries (CHỈ INSERT): mỗi OrderConfirmed một nhóm bút toán cùng txn_id: Nợ PROVIDER_RECEIVABLE = tổng; Có REVENUE_TICKET, REVENUE_MERCH (chưa thuế), VAT_PAYABLE_TICKET, VAT_PAYABLE_MERCH. Số nguyên VND; quy tắc làm tròn ghi trong code và ADR; luôn net + vat = gross. Constraint trigger DEFERRABLE INITIALLY DEFERRED kiểm mỗi txn_id cân bằng khi commit. Trigger chặn UPDATE/DELETE và thu hồi quyền của finance_user.
- [M] VAT cấu hình: VAT_RATE_TICKET, VAT_RATE_MERCH, PRICES_INCLUDE_VAT (mặc định true). Giá trị mặc định chỉ là giả định để phát triển; ghi rõ trong README/ADR là cần xác nhận với quy định thuế hiện hành.
- [M] revenue_records (gross, net, vat_rate, vat, items jsonb, reversed_at). RefundCompleted => ghi bút toán ĐẢO (không sửa bút toán cũ), đặt reversed_at; số hoàn khác tổng order => ghi AuditRecorded cảnh báo, không đảo.
- [M] event_sales_stats(event_id, ticket_class_id, sold, revenue_vnd) và event_revenue_stats(event_id, category, gross, net, vat) cập nhật cùng transaction; hoàn tiền thì trừ lại. API GET /v1/organizer/events/{id}/stats (ORGANIZER với tenant khớp events_ref, hoặc ADMIN).
- [S] audit_logs hash-chain: hash = SHA256(prev_hash || JSON chuẩn hóa), prev_hash đầu là 64 ký tự 0, ghi tuần tự bằng pg_advisory_xact_lock; GET /v1/admin/audit/verify trả {ok, checked, first_broken_id?}; GET /v1/admin/audit.
- [S] DlqCollector consume các topic *.dlq vào bảng dead_letters; GET /v1/admin/dlq, POST /v1/admin/dlq/{id}/replay (phát lại lên topic gốc với CÙNG message_id), POST /v1/admin/dlq/{id}/discard.
- [C] SSE GET /v1/organizer/events/{id}/stats-stream.
- Tạo bảng invoices, invoice_items theo ERD cho Sơn (S-505) nhưng KHÔNG viết logic hóa đơn; không làm payouts. Xuất openapi.json và docs/api/finance.yaml cho Vũ.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
1. Tổng Nợ = tổng Có mọi txn_id; chèn nhóm lệch => commit thất bại.
2. UPDATE/DELETE trên ledger_entries và audit_logs bị chặn kể cả bằng SQL trực tiếp bằng finance_user.
3. Property test: nhiều mức giá/VAT, net + vat = gross.
4. OrderConfirmed trùng => ghi 1 lần; RefundCompleted => doanh thu order về 0 và event_sales_stats giảm đúng.
5. Sửa tay 1 bản ghi audit_logs bằng superuser => verify báo đúng first_broken_id; 50 audit song song => chuỗi vẫn hợp lệ.
6. Organizer A không xem được thống kê event của B (403).
Lệnh: pnpm --filter @ticketing/finance lint typecheck test test:int test:conc, rồi pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-402. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-402.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.
- Mã lõi (sổ cái, trigger, hash-chain): ghi vào PR mục 'Cần 2 người đọc'.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-403 Load test vòng 1

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0002, docs/test-reports/s1-baseline.md, infra/k6/.

NHIỆM VỤ: task <built-in function id> "Load test vòng 1 (S1–S3) và tối ưu" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/loadtest-t403-round1
Phụ thuộc phải là Done: Cổng G2, T-304 (T-404 nên xong để có số đo).

MỤC TIÊU: Có số đo đáng tin cho S1–S3, tìm và xử lý nút cổ chai, KHÔNG đánh đổi tính đúng đắn.

CẦN LÀM / LƯU Ý:
- infra/compose/docker-compose.apps.yml (service chạy trong container, build từ Dockerfile của từng service, scale được), infra/kong/kong.apps.yml (upstream theo tên container), make apps-up / apps-down / apps-scale svc=booking n=3. KIỂM TRA bằng thực nghiệm rằng Kong phân tải qua nhiều replica (header X-Served-By có id instance, thêm vào booking); nếu DNS round-robin không hoạt động thì dùng khai báo upstreams với nhiều targets.
- PgBouncer cho booking_db và payment_db (transaction mode; Prisma cần ?pgbouncer=true). Chọn image còn pull được, ghi lý do vào PR; không pull được => dừng và hỏi.
- infra/k6/s2-read-heavy.js, infra/k6/s3-full-flow.js (dùng lại lib/auth.js), scripts/verify-consistency.sh, docs/test-reports/loadtest-1.md.
- S1: như T-205. S2: 10.000 VU xem danh sách/chi tiết sự kiện và seat-status (tăng dần 1 phút, giữ 3 phút). S3: 500 VU queue/join => holds => checkout => thanh toán Mock (90% thành công, trễ 1-3 giây, 5% IPN trùng) => poll đến CONFIRMED, bật Waiting Room.
- verify-consistency (sau khi consumer/relay hết backlog): không ghế SOLD trùng; số order CONFIRMED khớp số OrderConfirmed đã phát và số revenue_records (và tickets nếu ticket-service đã chạy); không còn order quá hạn chưa xử lý; outbox chưa gửi = 0; DLQ trống; sổ cái cân bằng.
- Tối ưu: mỗi lần đổi MỘT thứ (pool, PgBouncer, index qua EXPLAIN ANALYZE, batchSize/pollIntervalMs của relay, số replica 1->2->3); mỗi thay đổi ghi bảng: thay đổi, giả thuyết, trước, sau, giữ hay hoàn tác.
- CẤM: bỏ unique index/kiểm tra đúng đắn; nới rate limit để che lỗi mà không ghi rõ; đo trên cấu hình khác với cấu hình báo cáo.
- Báo cáo ghi: cấu hình máy và replica, k6 chạy ở đâu, bảng RPS/p50/p95/p99/tỷ lệ lỗi, nút cổ chai, bảng thay đổi, kết quả verify-consistency. Mục tiêu đề xuất (chốt sau khi đo): S2 p95 < 300 ms; S3 lỗi 5xx < 1%; oversell = 0. Chưa đo được thì ghi "chưa đo".

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
docker compose -f infra/compose/docker-compose.apps.yml config; bash -n các script; chạy được S1/S2/S3 với số VU nhỏ (smoke) và verify-consistency thoát 0; chạy verify-consistency với dữ liệu cố ý sai để chứng minh nó báo lỗi. Tôi sẽ chạy k6 đầy đủ từ máy thứ hai và dán số liệu thật cho bạn.

Ràng buộc chung:
- Chỉ làm task T-403. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-403.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-404 Prometheus và Grafana

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, packages/common, services/_template, infra/compose/.

NHIỆM VỤ: task <built-in function id> "Prometheus + Grafana cơ bản (RED)" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/infra-t404-prometheus-grafana
Phụ thuộc phải là Done: T-102.

MỤC TIÊU: Có dashboard RED theo service để đọc số đo khi load test.

CẦN LÀM / LƯU Ý:
- infra/compose/docker-compose.obs.yml, infra/prometheus/prometheus.yml, infra/grafana/provisioning/{datasources,dashboards}/, infra/grafana/dashboards/red.json, make obs-up / obs-down.
- Prometheus (9090) scrape /metrics của từng service (dev: host.docker.internal:<cổng>; apps compose: theo tên container). Grafana cổng 3030 (tránh trùng cổng web), datasource và dashboard provision bằng FILE, không cấu hình tay.
- [M] Kiểm tra packages/common đã có histogram HTTP http_server_request_duration_seconds (nhãn service, method, route, status_class); thiếu thì thêm HttpMetricsInterceptor và dùng trong template. KHÔNG gắn id người dùng/sự kiện làm nhãn.
- [M] Dashboard RED: Rate, Errors (tỷ lệ 5xx), Duration (p50/p95/p99), biến chọn service.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
make obs-up; chạy k6 smoke ngắn; Prometheus API báo up == 1 cho các service đang chạy; dashboard có dữ liệu (ảnh chụp lưu docs/test-reports/obs-red.png). Rồi pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-404. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-404.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-405 Payment cho đơn resale

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0009-post-payment-flow.md (C7), packages/event-contracts/, services/payment.

NHIỆM VỤ: task <built-in function id> "Payment cho đơn resale" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/payment-t405-resale-payments
Phụ thuộc phải là Done: T-302, T-303 (S-405 của Sơn có thể chưa xong).

MỤC TIÊU: Thanh toán đơn resale đi qua cùng payment-service, dùng lại IPN idempotent.

CẦN LÀM / LƯU Ý:
- Consumer ResaleOrderAwaitingPayment (resale.events) => payables(purpose=RESALE, ref_id=resale_order_id).
- POST /v1/payments nhận {resale_order_id, provider} hoặc {order_id, provider} (đúng MỘT trong hai, nếu không => 422). payments.purpose/ref_id/event_id lưu đúng.
- Thành công => outbox PaymentSucceeded{purpose: RESALE, resale_order_id}; thất bại => PaymentFailed{purpose: RESALE, ...}. Dùng lại IPN idempotent của T-303; không tạo luồng riêng.
- Chưa có S-405: dùng script scripts/publish-fake-resale-order.ts phát ResaleOrderAwaitingPayment bằng newMessage. Không sửa services/resale.
- Ngoài phạm vi: hoàn tiền đơn resale (ghi vào hạn chế đã biết).

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Mock hoàn tất thanh toán resale; IPN trùng => 1 PaymentSucceeded; payment cho resale_order_id chưa có payables => 409 ORDER_NOT_READY; gửi cả hai khóa => 422.
Rồi pnpm --filter @ticketing/payment lint typecheck test test:int và pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-405. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-405.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-501 Giám sát đầy đủ

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, infra/compose/docker-compose.obs.yml, infra/grafana/, packages/common, packages/outbox-inbox.

NHIỆM VỤ: task <built-in function id> "Giám sát đầy đủ: Loki, exporters, Jaeger" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/infra-t501-observability
Phụ thuộc phải là Done: T-404.

MỤC TIÊU: Đọc được hệ thống bằng log, số đo hệ thống và số đo nghiệp vụ; (tùy chọn) truy vết xuyên service.

CẦN LÀM / LƯU Ý:
- [M] Loki + Promtail (infra/loki, infra/promtail): thu log container, pipeline json để lọc theo request_id, trace_id, service, level; dashboard "Logs" + ví dụ truy vấn trong README. Mount docker.sock chỉ ở dev/test.
- [M] Exporters: kafka-exporter (lag theo group/topic), redis_exporter (ops/s, bộ nhớ, evicted_keys, kết nối), postgres_exporter (kết nối theo database; tài khoản CHỈ ĐỌC, ghi rõ trong tài liệu).
- [M] Metric nghiệp vụ: orders_total{status}, seat_holds_total{result=ok|conflict|limit}, queue_length, outbox_pending (gauge định kỳ), inbox_duplicates_total, dlq_published_total{topic}, payments_total{status}, refunds_total{status}. Không nhãn phân tán cao.
- [M] Dashboard "System" và "Business".
- [S] Jaeger (all-in-one hoặc bản còn được hỗ trợ; ghi phiên bản): service xuất OTLP khi có OTEL_EXPORTER_OTLP_ENDPOINT; trace HTTP.
- [C] traceparent qua header Kafka (OutboxRelay gắn, createInboxConsumer đọc) và plugin opentelemetry của Kong (kiểm tra có trong Kong 3.8).

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Tìm 1 đơn theo request_id trong Loki thấy log của >= 3 service; dashboard System/Business có dữ liệu khi chạy k6; dừng Kafka thì outbox_pending tăng và lag đổi; nếu làm [S]/[C] thì một trace nối gateway => booking => payment. Rồi pnpm format:check && pnpm build.

Ràng buộc chung:
- Chỉ làm task T-501. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-501.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-502 Chaos S4

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0002, 0005, 0009, scripts/verify-consistency.sh, infra/k6/.

NHIỆM VỤ: task <built-in function id> "Chaos test S4 và sửa lỗi phát hiện" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/infra-t502-chaos-s4
Phụ thuộc phải là Done: T-403.

MỤC TIÊU: Chứng minh hệ thống chịu lỗi đúng như ADR mô tả; sửa các chỗ không đúng.

CẦN LÀM / LƯU Ý:
- infra/chaos/run-chaos.sh <kịch bản> (docker compose stop/start/pause; trên Git Bash đặt MSYS_NO_PATHCONV=1); docs/test-reports/chaos-s4.md; các bản sửa lỗi (mỗi bản sửa kèm test).
- Kịch bản (chạy trong lúc S3 đang tải): 1) dừng Redis 60 giây: /holds và /checkout trả 503 nhanh (<= 1 giây, không treo), không order lỡ dở, Redis lên lại phục vụ lại trong vài giây, không oversell; 2) FLUSHALL Redis + khởi động lại booking: rehydrate dựng lại ghế từ DB; 3) dừng Kafka 2 phút: HTTP vẫn nhận checkout, outbox_pending tăng, Kafka lên backlog tự xả không mất không trùng; 4) payment trễ vượt hạn order: REFUND_REQUIRED => tự hoàn tiền, không phát vé cho order hết hạn; 5) khởi động lại booking_db: 503 có kiểm soát, pool tự phục hồi; 6) kill một replica booking giữa tải: replica còn lại chạy tiếp, sweeper/relay không xử lý đôi; 7) bão IPN trùng (50 lần mỗi IPN): chỉ xử lý 1 lần.
- Sửa mã nếu chưa có: ioredis enableOfflineQueue:false, maxRetriesPerRequest thấp, commandTimeout; /holds trả 503 HOLD_BACKEND_UNAVAILABLE; /health/ready phản ánh Redis/DB; kết nối lại tự động.
- Sau mỗi kịch bản chạy verify-consistency. Báo cáo: kịch bản, mong đợi, thực tế, thời gian phục hồi, bản sửa, kết quả kiểm tra. Kịch bản chưa chạy => ghi "chưa chạy".
- Bạn KHÔNG có quyền dừng container của tôi: viết script và test, tôi sẽ chạy kịch bản trên máy thật.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
bash -n infra/chaos/run-chaos.sh; test cho các bản sửa mã (Redis down => 503 nhanh, không treo) chạy được bằng Testcontainers; verify-consistency thoát 0 sau test. Rồi pnpm lint typecheck test:int format:check build cho package đụng tới.

Ràng buộc chung:
- Chỉ làm task T-502. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-502.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-503 Hardening bảo mật

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0003, 0004, docs/agent/CONVENTIONS.md, infra/kong/kong.yml, .github/workflows/ci.yml.

NHIỆM VỤ: task <built-in function id> "Hardening bảo mật" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: chore/repo-t503-hardening
Phụ thuộc phải là Done: (không có).

MỤC TIÊU: Có bằng chứng cho phần bảo mật dữ liệu khi bảo vệ; mọi lỗi mức cao đã xử lý.

CẦN LÀM / LƯU Ý:
- [M] OWASP ZAP (zap-api-scan với openapi.json từng service, chạy bằng container; CHỈ quét hệ thống của mình). Báo cáo docs/test-reports/zap.md; sửa mọi lỗi mức cao; giả dương ghi lý do ở .zap/rules.tsv.
- [M] Bí mật: loadEnv hỗ trợ biến *_FILE (đọc từ file Docker secret); prod compose dùng secrets: cho mật khẩu DB, khóa JWT, INTERNAL_API_KEY, VNPAY_*. gitleaks: hook pre-commit (nếu cài) + job CI (binary hoặc action; lưu ý điều kiện giấy phép action với tổ chức).
- [M] Container: mọi Dockerfile chạy user không root, có HEALTHCHECK; CI quét image bằng Trivy (CRITICAL,HIGH làm fail); pnpm audit --prod không còn lỗi cao/nghiêm trọng chưa ghi chú.
- [M] Mạng prod: chỉ Kong (hoặc tunnel) tiếp xúc internet; DB/Redis/Kafka chỉ trong mạng nội bộ.
- [M] Rate limit và đầu vào: giới hạn riêng cho đăng nhập/đăng ký, holds, checkout, queue/join; giới hạn kích thước body; CORS chỉ đúng origin.
- [S] Tài liệu xoay INTERNAL_API_KEY và khóa JWT không gián đoạn dịch vụ.
- Đầu ra: docs/security/hardening-checklist.md: bảng đối chiếu OWASP API Security Top 10 với biện pháp và ĐƯỜNG DẪN BẰNG CHỨNG (test, cấu hình, báo cáo). Mục chưa đáp ứng ghi thẳng là chưa đáp ứng.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
ZAP không còn lỗi cao; /internal từ ngoài => 404; token sai thuật toán => 401 (test T-102 còn chạy); gitleaks quét lịch sử không có bí mật; trivy/pnpm audit sạch hoặc có ghi chú. Rồi pnpm format:check && pnpm build && pnpm test.

Ràng buộc chung:
- Chỉ làm task T-503. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-503.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-504 Load test vòng 2

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/test-reports/loadtest-1.md, docs/test-reports/chaos-s4.md, infra/k6/.

NHIỆM VỤ: task <built-in function id> "Load test vòng 2 và soak test" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: docs/loadtest-t504-round2
Phụ thuộc phải là Done: T-502, T-501, T-503.

MỤC TIÊU: So sánh trước/sau các bản sửa; đo co giãn và độ ổn định dài hơi.

CẦN LÀM / LƯU Ý:
- Chạy lại S1–S3 trên CÙNG cấu hình như vòng 1 sau các bản sửa tuần 4–5; thêm soak test 20-30 phút tải vừa (RAM tăng đều, kết nối DB không trả, lag Kafka trôi).
- Đo co giãn: 1 -> 2 -> 3 replica booking (RPS và p95).
- docs/test-reports/loadtest-2.md: so sánh với vòng 1 cạnh nhau, bảng năng lực (RPS bền vững, p95), giới hạn đã biết, kết quả verify-consistency. Không tối ưu mới trừ khi có suy giảm so với vòng 1 (khi đó ghi nguyên nhân).
- Ghi đúng số đo thực tế; chưa đo => "chưa đo". Tôi sẽ chạy k6 từ máy thứ hai và dán số liệu thật.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Báo cáo có đủ bảng, mọi con số dẫn tới đầu ra đo; verify-consistency thoát 0 cho từng lần chạy (nếu bạn chạy được). Rồi pnpm format:check.

Ràng buộc chung:
- Chỉ làm task T-504. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-504.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-505 Pipeline deploy

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0008-deploy-product-level.md, infra/compose/docker-compose.prod.yml, infra/compose/docker-compose.apps.yml, infra/deploy/deploy.sh, .github/workflows/.

NHIỆM VỤ: task <built-in function id> "Pipeline deploy tự động" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: feat/ci-t505-deploy-pipeline
Phụ thuộc phải là Done: T-207, T-403.

MỤC TIÊU: Merge vào main thì staging tự cập nhật; prod chỉ chạy sau khi có người duyệt; hỏng thì tự quay lại.

CẦN LÀM / LƯU Ý:
- deploy-staging.yml (chạy khi CI trên main xanh): build image từng service có Dockerfile (matrix), quét Trivy, đẩy GHCR (ghcr.io/<owner>/ticketing-<service>:<sha>), SSH vào VPS chạy infra/deploy/deploy.sh <sha>. deploy-prod.yml chạy tay (workflow_dispatch) với environment có người duyệt.
- deploy.sh: pull image theo IMAGE_TAG => chạy migration (prisma migrate deploy, mỗi service một job một lần, TRƯỚC khi bật bản mới) => up -d => scripts/smoke-test.sh (health các service + 1 API đọc qua Kong) => thất bại thì tự khôi phục .last_good; ghi .last_good khi smoke test đạt.
- Dùng lại docker-compose.apps.yml làm nền, ghi đè bằng image: từ GHCR. Quy ước migration "mở rộng rồi thu hẹp" ghi vào docs/ops/migrations.md.
- Việc của tôi: tạo GitHub environments (staging, production), secrets (VPS_HOST, VPS_USER, VPS_SSH_KEY), quyền packages: write, người duyệt production. KHÔNG tự đặt bí mật nào vào repo.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
actionlint (hoặc kiểm tra cú pháp YAML) các workflow; bash -n deploy.sh smoke-test.sh; docker compose config với image giả; mô phỏng smoke test fail để chứng minh nhánh khôi phục chạy (có thể bằng script cục bộ). Tôi sẽ thử end-to-end trên GitHub và VPS.

Ràng buộc chung:
- Chỉ làm task T-505. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-505.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-601 Deploy production

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/adr/0008, infra/deploy/, docs/ops/vps-setup.md, infra/compose/docker-compose.prod.yml.

NHIỆM VỤ: task <built-in function id> "Deploy production, backup và diễn tập khôi phục" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: chore/infra-t601-production
Phụ thuộc phải là Done: T-505, Cổng G3.

MỤC TIÊU: Hệ thống chạy trên domain thật, có backup và đã diễn tập khôi phục.

CẦN LÀM / LƯU Ý:
- Truy cập: Cloudflare Tunnel (cloudflared chạy trong compose, token là secret) để không mở cổng vào; dự phòng: Cloudflare proxy + chứng chỉ gốc trên Kong. TLS Full (strict).
- infra/backup/backup.sh (pg_dump từng database => nén => đẩy bucket MinIO backups, giữ 7 bản hằng ngày), infra/backup/restore.sh <db> <file>; hướng dẫn cron/timer trong docs/ops/.
- Diễn tập khôi phục: khôi phục booking_db vào database tạm, so số dòng các bảng chính, ghi THỜI GIAN thực tế vào docs/ops/restore-drill.md (bản mẫu có sẵn chỗ điền, số liệu do tôi chạy).
- Grafana prod sau xác thực (basic auth hoặc Cloudflare Access), không mở công khai.
- docs/ops/runbook.md: khởi động/dừng, deploy, rollback, xem log, khôi phục, xoay bí mật, sự cố thường gặp (Kafka đầy, DLQ có message, Redis đầy, order kẹt).
- Việc của tôi: domain, Cloudflare, token tunnel, bí mật prod, cron backup, chạy diễn tập khôi phục thật.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
bash -n các script; docker compose config prod hợp lệ; backup/restore thử được trên stack dev với dữ liệu mẫu (nếu có Docker); runbook có đủ các mục trên. Rồi pnpm format:check.

Ràng buộc chung:
- Chỉ làm task T-601. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-601.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-602 Load test cuối trên môi trường thật

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/test-reports/, infra/k6/, infra/chaos/.

NHIỆM VỤ: task <built-in function id> "Load test và chaos lần cuối trên môi trường thật" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: docs/loadtest-t602-final
Phụ thuộc phải là Done: T-601.

MỤC TIÊU: Báo cáo hiệu năng cuối cùng, mọi con số có nguồn đo.

CẦN LÀM / LƯU Ý:
- Cập nhật script k6/chaos nhận BASE_URL và token từ biến môi trường để chạy từ MÁY NGOÀI VPS. Cloudflare có thể chặn/giới hạn tải: chạy vào subdomain không qua proxy hoặc staging, ghi rõ cách chạy.
- docs/test-reports/performance-final.md (khung có sẵn chỗ điền): cấu hình VPS và số replica, kết quả so với vòng 1-2, bảng năng lực, giới hạn đã biết, kết quả kiểm tra đúng đắn sau từng kịch bản. KHÔNG con số nào không có nguồn đo; chưa có số thì ghi "chưa đo".
- Việc của tôi: chạy k6 và chaos trên môi trường thật, đưa số liệu để bạn điền báo cáo.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Script nhận biến môi trường và chạy smoke với VU nhỏ vào môi trường dev; khung báo cáo có đủ mục. Rồi pnpm format:check.

Ràng buộc chung:
- Chỉ làm task T-602. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-602.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-603 Tài liệu cuối

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/architecture/, docs/adr/, docs/test-reports/, docs/security/, docs/ops/, toàn bộ services/*/prisma/schema.prisma.

NHIỆM VỤ: task <built-in function id> "Tài liệu cuối (as-built)" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: docs/docs-t603-final-documentation
Phụ thuộc phải là Done: (không có).

MỤC TIÊU: Tài liệu mô tả hệ thống ĐÃ CÓ, mọi số liệu dẫn nguồn đo, phần chưa làm ghi thẳng là hạn chế.

CẦN LÀM / LƯU Ý:
- docs/final/: 01-architecture.md (kiến trúc thực tế, sơ đồ theo code), 02-concurrency.md (6 lớp phòng thủ + bằng chứng + báo cáo), 03-data-model.md (ERD từng service theo schema.prisma thực tế), 04-sequences.md (đặt vé và saga, thanh toán muộn, hoàn lô, resale; check-in offline do Sơn bổ sung), 05-security.md (từ hardening checklist), 06-testing.md (các loại test + mục lục báo cáo), 07-operations.md (trỏ runbook), 08-known-limitations.md, 09-demo-script.md (phối hợp Vũ).
- Rà tất cả ADR: đổi trạng thái thành "Đã chấp nhận" hoặc "Bị thay thế"; thêm ADR cho các quyết định phát sinh khi làm (Prisma kèm SQL tay, kafkajs, PgBouncer, cách làm tròn VAT...).
- Đối chiếu tài liệu với code: liệt kê CÁC CHỖ LỆCH cho tôi duyệt, không tự "sửa cho khớp" bằng cách bỏ bớt sự thật.
- KHÔNG đưa số liệu hiệu năng nào không có báo cáo đo tương ứng.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
Mọi lệnh trong tài liệu chạy được (nếu chạy được thì liệt kê, không thì ghi lý do); mọi đường dẫn tồn tại; danh sách chỗ lệch giữa tài liệu và code. Rồi pnpm format:check.

Ràng buộc chung:
- Chỉ làm task T-603. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-603.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
- Chạy kiểm chứng thật và ghi kết quả thật. Không chạy được (ví dụ không có Docker) thì ghi "chưa chạy" cùng lý do và liệt kê lệnh tôi cần chạy thay. Không viết "đã pass" nếu chưa chạy.
- Không push vào main, không tự merge, không commit secret hay .env. Cập nhật STATUS.md thành "In review" khi mở PR.

Bắt đầu bằng bản tóm tắt tối đa 10 dòng (hiểu task, phụ thuộc đã đủ chưa, kế hoạch file, rủi ro). Chờ tôi nói "OK" rồi mới viết code.
```

## T-604 Sửa lỗi và chuẩn bị bảo vệ

```text
Bạn là agent làm việc cho Tuấn trong repo này.

Đọc theo thứ tự: AGENTS.md, docs/agent/TUAN_PLAN.md (mục 3 và đặc tả của task), docs/agent/STATUS.md, docs/final/, docs/learning/defense-notes.md, docs/adr/, docs/test-reports/.

NHIỆM VỤ: task <built-in function id> "Reset demo và ngân hàng câu hỏi bảo vệ" theo AGENTS.md mục 2 (Bước 0 đến Bước 8). Đặc tả đầy đủ: docs/agent/TUAN_PLAN.md, mục <built-in function id>.
Nhánh: chore/repo-t604-demo-defense
Phụ thuộc phải là Done: (không có).

MỤC TIÊU: Có script đưa dữ liệu demo về trạng thái ban đầu và bộ câu hỏi bảo vệ có dẫn chứng.

CẦN LÀM / LƯU Ý:
- scripts/reset-demo.sh: đưa dữ liệu demo về trạng thái ban đầu (phối hợp seed của Vũ; hỏi tôi nếu chưa rõ lệnh seed). Chỉ chạy trên môi trường dev/staging, có xác nhận "gõ tên môi trường để tiếp tục"; KHÔNG chạy trên prod.
- docs/final/10-defense-qa.md: 30 câu hỏi khó nhất (tính đúng đắn, hiệu năng, đánh đổi, bảo mật, giới hạn), mỗi câu có trả lời ngắn và dẫn chứng (ADR, test, báo cáo đo). Không bịa số liệu.
- docs/final/11-rehearsal-checklist.md: danh sách kiểm tra trước buổi bảo vệ (môi trường, dữ liệu, video dự phòng, phương án B dùng MockAdapter).
- Sửa lỗi phát sinh dùng prompt "Sửa lỗi" riêng, không gộp vào task này.

KIỂM CHỨNG BẮT BUỘC (ghi số liệu thật vào run report):
bash -n scripts/reset-demo.sh; chạy thử trên dev; các câu hỏi đều dẫn tới file có thật. Rồi pnpm format:check.

Ràng buộc chung:
- Chỉ làm task T-604. Xong thì báo cáo theo AGENTS.md mục 10 và DỪNG. Không tự làm task tiếp theo.
- Bước 0: kiểm tra phụ thuộc trong STATUS.md. Chưa Done hoặc gặp điều kiện dừng (AGENTS.md mục 9) thì dừng và hỏi tôi một lượt, gom hết câu hỏi.
- Các quyết định trong ADR-0009 và ADR-0010 đã chốt: không đổi. Thấy mâu thuẫn thì dừng và hỏi.
- Làm mục [M] trước, rồi [S]; mục [C] chỉ làm khi tôi bảo.
- Image Docker mới phải `docker pull` được trước khi commit và ghim tag qua .env; không pull được thì dừng và hỏi.
- Tạo docs/agent/runs/T-604.md từ RUN_REPORT_TEMPLATE.md và điền "Kế hoạch" TRƯỚC khi viết code.
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

### Sửa lỗi (bug fix)

```text
Đọc AGENTS.md. Lỗi cần sửa: <mô tả hiện tượng, bước tái hiện, môi trường, log nếu có>.
Quy trình: (1) tái hiện lỗi và mô tả nguyên nhân gốc (chưa sửa); (2) viết test ĐỎ tái hiện lỗi; (3) sửa tối thiểu; (4) chạy lại test mới và toàn bộ test của package;
(5) nếu lỗi do hiểu sai đặc tả/hợp đồng thì DỪNG và hỏi tôi. Nhánh fix/<scope>-<mô-tả>. Một lỗi một nhánh một PR. Báo cáo theo AGENTS.md mục 10 rồi dừng.
Không sửa file ngoài vùng sở hữu; không refactor ngoài phạm vi; không bịa kết quả test.
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
Bạn là reviewer khó tính, KHÔNG viết code. Đọc docs/agent/CONVENTIONS.md, rồi xem diff của nhánh <tên-nhánh> so với main
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
