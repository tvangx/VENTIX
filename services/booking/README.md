# Booking service — T-201 / T-202 / T-203 / T-204

Scaffold có sẵn từ T-102, cổng 3003. T-201 thêm schema `booking_db`; T-202 thêm Lua và API holds; T-203 thêm consumer lifecycle và rehydrate Redis; T-204 thêm trạng thái ghế, SSE và sweeper hold. Chưa triển khai checkout hoặc sweeper order. Health, JWT, log JSON, metrics và endpoint mẫu `/v1/whoami` được giữ từ template.

## Chạy local

Từ thư mục gốc repo:

```bash
make up && make verify
cp services/booking/.env.example services/booking/.env
pnpm --filter @ticketing/booking exec prisma migrate deploy
pnpm --filter @ticketing/booking dev
```

Prisma CLI đọc `.env` trong thư mục service. Không commit `.env`. `DATABASE_URL` phải trỏ tới `booking_db` bằng `booking_user`; env schema từ chối user/DB khác. Không dùng user `postgres`, không FK hoặc JOIN sang DB service khác.

## Consumer lifecycle và rehydrate (T-203)

Consumer dùng `createInboxConsumer`, group mặc định `booking-event-lifecycle`, Inbox consumer name cố định `booking-event-lifecycle`.
Đọc `event.lifecycle` từ đầu cho group mới; Inbox, snapshot và stock cùng một transaction.
Chỉ nhận **lifecycle v2**, xem [ADR-0011](../../docs/adr/0011-versioned-event-lifecycle.md).
V1 thiếu payload/version nên đi `event.lifecycle.dlq` ngay, không ghi Inbox; không suy đoán hoặc gọi DB event-service.
Sơn cần chuyển producer sang v2 và phát lại snapshot/cancellation v2 hợp lệ trước khi dùng consumer này trên dữ liệu thật.

Snapshot chỉ thay đổi khi event_version tăng; bản cũ/bằng phiên bản không sửa stock.
`total=GREATEST(capacity,sold)` bảo toàn vé đã bán. Cancel đặt CANCELLED và pricing_ready=false;
cancel đến trước approval tạo tombstone để chặn approval cũ. `seat_map_version` lưu từ snapshot v2,
map thay đổi đặt pricing_ready=false; consumer không bao giờ đặt cờ true (T-203b phụ trách).
Updated giữ map cũ thì giữ giá trị pricing_ready hiện tại.

Startup đọc allocation từ booking_db, phân trang 500 dòng theo UUID:

- SOLD → `seat:{evt:<id>}:<seatId>=S`, thêm vào `sold:{evt:<id>}`.
- HELD chỉ khôi phục khi order PENDING/AWAITING_PAYMENT chưa hết hạn, value `H:<userId>`;
  `PXAT` đúng hạn DB, tạo hold set cùng TTL và hexp để các thao tác T-202 đọc được dữ liệu đã khôi phục.
- Lua kiểm tra kiểu metadata trước khi ghi; `SET NX` không ghi đè ghế/TTL/metadata đã có.
  Có thể chạy lại hoặc chạy nhiều replica. Không dùng KEYS/SCAN. Hold chỉ có trong Redis không được phục hồi.

`/health/ready` trả 503 đến khi rehydrate và consumer khởi động xong, sau đó kiểm tra DB như trước.
Nếu startup lỗi, readiness giữ 503; khắc phục DB/Redis/Kafka rồi restart booking để chạy lại.
Shutdown chờ job/consumer dừng trước khi đóng kết nối. Log startup có số allocation dựng lại và trace_id/request_id.

Env mới trong `.env.example` và schema: `KAFKA_BROKERS` (danh sách host:port phân cách dấu phẩy),
`EVENT_CONSUMER_GROUP_ID`, `EVENT_CONSUMER_ENABLED=true`, `REHYDRATE_ENABLED=true`.
Chỉ tắt rehydrate khi đã xác nhận Redis đủ dữ liệu, hoặc trong test chỉ kiểm tra DB/OpenAPI.
Sau Redis mất dữ liệu cần restart booking; task này không tự khôi phục khi Redis lỗi giữa lúc process đang chạy.
Với replica còn phục vụ traffic, NX ưu tiên giá trị Redis đã có; unique index PostgreSQL vẫn là chốt chống bán trùng.

### Dữ liệu giả khi chưa có S-203

Từ root, build contracts rồi chạy script (chỉ dữ liệu giả local):

```bash
pnpm --filter @ticketing/event-contracts build
pnpm --filter @ticketing/booking event:fake
```

Lệnh thứ hai biên dịch strict `scripts/publish-fake-event.ts` vào dist rồi chạy trên Node 20.
Script dùng newMessage/parseMessage, version=2, key=event_id và acks=all; đây là công cụ dev được giao,
không phải producer nghiệp vụ. ID mặc định ngẫu nhiên và được in ra để kiểm tra;
có thể đặt `FAKE_EVENT_ID`, `FAKE_ORGANIZER_ID`, `FAKE_CLASS_ID`, `FAKE_EVENT_VERSION`, `FAKE_SEAT_MAP_VERSION`
qua environment theo ví dụ `.env.example`. Script không tự đọc `.env` và không bật pricing_ready.
Không FLUSHALL Redis dev; test rehydrate tự dùng container Redis riêng, xóa rồi restart app và đối chiếu DB.

## Trạng thái ghế realtime (T-204)

- `GET /v1/events/:id/seat-status` trả `{ sold: string[], held: string[], as_of: ISO-8601 UTC }`.
  Lua đọc `SMEMBERS sold:{evt:<id>}` và `ZRANGEBYSCORE hexp:{evt:<id>} now +inf` trong cùng snapshot;
  thời gian lấy từ Redis TIME. Không đọc từng seat key, không KEYS/SCAN. Event chưa có dữ liệu trả mảng rỗng.
- `GET /v1/events/:id/seat-stream` trả `text/event-stream`, đầu tiên `event: snapshot` có cùng payload,
  sau đó `event: delta`, data là mảng ngắn như `["H:<seatId>","A:<seatId>","S:<seatId>"]`.
  Mỗi 500 ms chỉ gửi trạng thái cuối cùng của mỗi ghế thay đổi; không gửi lô rỗng hay toàn map.
  H = held, A = available, S = sold; luồng bán phát S thuộc task checkout sau này.
- Hai endpoint dùng JWT bearer của service; event UUID được validate và chuyển về chữ thường.
  SSE từ chối `403 ADMISSION_REQUIRED` khi bật Waiting Room, giống holds, đến khi T-304 có guard admission.
  FE dùng fetch streaming hỗ trợ header Authorization; không truyền token qua query string.
  Qua Kong dùng `/api/booking/v1/events/:id/seat-status` hoặc `seat-stream`.
- Một kết nối Redis Pub/Sub dùng chung cho mỗi replica subscribe `delta:{evt:*}`. Snapshot Lua phát marker
  nội bộ cùng kênh; server bỏ delta trước marker và giữ delta sau marker ngay cả khi snapshot đang chờ trả về.
  Client nhận snapshot trước khi nhận delta. Không hỗ trợ replay `Last-Event-ID`: mỗi lần reconnect thay trạng thái
  bằng snapshot mới. Mất Pub/Sub thì server đóng SSE, client cần reconnect với backoff.
- Heartbeat comment mỗi 15 giây; response tắt cache và proxy buffering. Khi socket backpressure hoặc buffer
  vượt 10.000 ghế thay đổi/client, đóng stream để client reconnect lấy snapshot; không tích lũy vô hạn.
  Đóng tab/client hoặc shutdown sẽ gỡ listener và dọn kết nối.
- Sweeper chạy mỗi giây, không chạy chồng tick. Phân trang `event_snapshots` của booking_db theo event_id
  (100 event/trang), nên vẫn dọn event không có client SSE. Mỗi Lua xử lý tối đa 500 ghế đến hạn bằng
  `ZRANGEBYSCORE -inf now`; drain tối đa 20 batch/event/tick để không làm đói các event khác.
  Backlog lớn hơn 10.000 ghế/event có thể cần nhiều tick.
- Chỉ khi seat key đã vắng và `ZREM` thành công mới `PUBLISH A:<seatId>`, cùng Lua nguyên tử: nhiều replica
  không phát trùng. Không xóa seat key; TTL tự xóa. Index cũ nhưng key còn TTL được sửa score theo PTTL;
  key SOLD không TTL chỉ được dọn index, không phát A. Không đụng DB allocation hoặc phát sự kiện Kafka.
  Nếu event chưa tồn tại trong read-model thì sweeper không biết event đó; giữ ghế bình thường đã yêu cầu snapshot.
- Lỗi Redis trước khi mở SSE trả `503 SEAT_STATUS_UNAVAILABLE`, problem+json và `Retry-After: 1`.
  Log sweep lỗi có request_id/trace_id; metrics: `seat_stream_connections`, `seat_delta_batches_total`,
  `seat_expired_holds_total`, `seat_status_failures_total{operation}`. Không dùng event/user ID làm metric label.

Ví dụ (biến môi trường chứa token và event ID của phiên local):

```bash
curl -N -H "Authorization: Bearer $ACCESS_TOKEN" \
  "http://localhost:3003/v1/events/$EVENT_ID/seat-stream"
```

Test `seat-status-api.int-spec.ts` chạy 2 app booking thật, POST hold qua HTTP, đọc SSE H trong ≤1 giây,
đợi TTL và quan sát raw Pub/Sub chỉ có 1 A. `seat-expiry.conc-spec.ts` chạy 50 sweeper đồng thời trên 2
kết nối Redis thật, đối chiếu 100 ghế hết hạn không trùng. Unit test kiểm tra marker snapshot/delta, batching,
client disconnect, backpressure, buffer cap, heartbeat và phân trang/drain sweeper.

Giới hạn: Pub/Sub là best effort. Nếu process/Redis chết sau ZREM nhưng trước khi client nhận delta,
client phải lấy snapshot mới; TTL và trạng thái thực của ghế không phụ thuộc thông báo này.

## Schema và ràng buộc

| Bảng                  | Vai trò / khóa                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `orders`              | UUID, tiền bigint VND, idempotency key unique, timestamps và version                                  |
| `order_items`         | FK order; CHECK chỉ `TICKET_SEAT`, `TICKET_GA`, `MERCH`                                               |
| `seat_allocations`    | FK order; CHECK `HELD`, `SOLD`, `RELEASED`; unique theo event/seat khi active                         |
| `ticket_class_stock`  | PK `class_id`; CHECK `0 <= sold <= total`                                                             |
| `event_snapshots`     | PK `event_id`; event/seat-map version, ticket_classes/sale_window JSONB; pricing_ready mặc định false |
| `seat_pricing`        | PK `(event_id, seat_id)`; index `(event_id, seat_map_version)`                                        |
| `vouchers`            | UUID, code unique, discount/max uses/expiry; chưa có API voucher                                      |
| `voucher_redemptions` | PK `(voucher_id, order_id)`, FK nội bộ tới voucher/order                                              |
| `idempotency_keys`    | PK key, user_id, request_hash, response JSONB, created_at                                             |
| `outbox_events`       | SQL dùng chung; index chưa publish theo created_at                                                    |
| `processed_events`    | SQL dùng chung; PK `(message_id, consumer)`                                                           |

Khóa tự nhiên/khóa kép giữ theo ERD; không thêm UUID id thay thế cho các khóa này. ID UUID do ứng dụng cấp (UUIDv7 theo kiến trúc). Bảng nghiệp vụ có created_at; order/allocation/stock/voucher có updated_at + version. Với raw SQL, bên ghi phải tự tăng version và cập nhật updated_at; `@updatedAt` chỉ do Prisma Client xử lý.

`prisma/migrations/20261028152531_booking_schema/migration.sql` được tạo bằng `prisma migrate dev --create-only --name booking_schema`, sau đó sửa tay. File giữ nguyên khối SQL T-201: `uq_seat_active`, CHECK trạng thái/type/stock, index expiry/user/seat pricing. Prisma không biểu diễn partial index/CHECK đầy đủ; migration sau phải review SQL và giữ các ràng buộc này. Migration bao trong transaction; SQL lỗi sẽ rollback DDL.

ERD kiến trúc §5.3 còn liệt kê COMBO. Tuấn đã xác nhận dùng CHECK T-201 loại COMBO, giữ nguyên ERD trong task này. `REFUND_REQUIRED` được cho phép theo ADR-0009; CHECK kiểm tra tập trạng thái, logic chuyển trạng thái có điều kiện thuộc các task saga sau.

Client sinh riêng ở `generated/prisma` (không commit, tránh ghi đè client của service khác).

## Migration tiếp theo và rollback

```bash
pnpm --filter @ticketing/booking prisma:migrate:create --name <name>
# Mở migration MỚI, bổ sung SQL tay và review trước khi áp dụng.
```

`booking_user` local không có CREATEDB. Để dùng `migrate dev`, chạy trên Postgres development tạm với booking_user được cấp CREATEDB cho shadow DB; không cấp quyền này cho runtime/prod. T-201 tạo migration trên Testcontainers tạm, không đổi quyền user local. Production chỉ dùng `migrate deploy`.

Trước khi migrate môi trường có dữ liệu, sao lưu riêng booking_db. Migration đầu tiên chỉ thêm schema; rollback deploy bằng cách quay về bản ứng dụng trước và giữ schema. Nếu cần khôi phục DB, Tuấn phê duyệt thao tác và phục hồi backup booking_db; không chạy reset/drop tự động, không chỉnh migration đã áp dụng.

## Kiểm chứng

```bash
pnpm --filter @ticketing/booking lint
pnpm --filter @ticketing/booking typecheck
pnpm --filter @ticketing/booking test
pnpm --filter @ticketing/booking test:int
pnpm --filter @ticketing/booking test:conc
pnpm --filter @ticketing/booking openapi:export
pnpm format:check && pnpm build
```

Integration/concurrency cần Docker, dùng image `postgres:16` đã có trong template; role bootstrap chỉ khởi tạo container test, mọi migration/SQL kiểm chứng schema chạy bằng booking_user NOSUPERUSER NOCREATEDB. Test tự tạo DB rỗng và áp dụng migration bằng Prisma, không dùng DB local. Concurrency chạy 50 insert: đúng 1 thành công, 49 lỗi 23505. Chi tiết số liệu: [run report T-201](../../docs/agent/runs/T-201.md).

## Giữ ghế (T-202)

**Hold chỉ nằm ở Redis. Mất Redis thì user phải giữ lại ghế (chấp nhận).** Hold không tạo order hoặc ghi seat_allocations. Chốt chống oversell trong DB đã có partial unique index của T-201; đường checkout áp dụng index ở T-301. Rehydrate allocation/order thuộc T-203, không tái tạo hold thuần Redis.

Mọi endpoint xác thực JWT RS256; chủ hold chỉ lấy từ JWT, không nhận user_id từ request. API lỗi trả application/problem+json có request_id. Ví dụ (JWT từ identity, ID UUID thật của snapshot/ghế):

```http
POST /v1/holds
Authorization: Bearer <JWT>
Content-Type: application/json

{"event_id":"<event UUID>","seat_ids":["<seat UUID>"]}
```

- POST thành công: `201 {expires_at, seat_ids}` (expires_at ISO UTC). Cả batch thành công hoặc không ghi gì. Ghế đã SOLD hoặc của chủ khác: `409 SEAT_UNAVAILABLE {seat_id}`; vượt tổng số ghế của user/event: `422 HOLD_LIMIT_EXCEEDED`.
- Giữ lại cùng ghế bởi cùng user trả 201 và gia hạn TTL, không tăng số ghế. Idempotency dựa trên user/event/seat; header Idempotency-Key được chấp nhận nhưng không cache/replay response cũ vì yêu cầu gia hạn TTL. Không dùng bảng idempotency_keys của checkout cho hold Redis.
- `GET /v1/holds?event_id=<UUID>`: `200 {expires_at, seat_ids}`; không có hold trả `{expires_at:null,seat_ids:[]}`. Lọc ghế hết hạn hoặc đã đổi chủ ngay trong Lua. Nếu các ghế có hạn khác nhau, expires_at là hạn sớm nhất.
- `DELETE /v1/holds` nhận JSON `{event_id,seat_ids?}`, trả 204. Bỏ seat_ids để nhả toàn bộ ghế của user trong event; có seat_ids để nhả một phần. Chỉ xóa ghế còn mang đúng holderTag của JWT, gọi lặp an toàn. GET/DELETE vẫn dùng được khi event đóng bán/chưa pricing_ready để khách xem/nhả hold cũ.
- Input phải là UUID, danh sách ghế không rỗng/không trùng, tối đa 1000 phần tử. HOLD_MAX_SEATS quyết định giới hạn thực tế trong Lua, bao gồm những ghế đã giữ trước đó.

Đường POST chỉ đọc event_snapshots trong booking_db, không gọi event-service. Snapshot cho bán ở trạng thái APPROVED hoặc PUBLISHED; sale_window chứa `{starts_at,ends_at}` hoặc mảng các phase có hai trường này (UTC ISO-8601, cùng tên trường sale_phases trong event-contracts). Cửa sổ bán bao gồm starts_at, không bao gồm ends_at. Snapshot thiếu, trạng thái khác, cửa sổ sai/chưa mở/đã đóng: `404 EVENT_NOT_ON_SALE`. Snapshot chưa pricing_ready: `503 EVENT_NOT_READY` và `Retry-After: 1`. T-202 dùng snapshot dựng sẵn trong test; nạp snapshot/pricing thuộc T-203/T-203b.

| Biến               | Mặc định               | Ý nghĩa                                                           |
| ------------------ | ---------------------- | ----------------------------------------------------------------- |
| REDIS_URL          | redis://localhost:6379 | Chỉ nhận redis:// hoặc rediss://                                  |
| HOLD_TTL_SECONDS   | 600                    | Số nguyên 1–86400 giây                                            |
| HOLD_MAX_SEATS     | 6                      | Số nguyên 1–1000 ghế/user/event                                   |
| ADMISSION_REQUIRED | false                  | Tới T-304; bật true hiện từ chối POST bằng 403 ADMISSION_REQUIRED |
| HOLDLOG_ENABLED    | false                  | Chỉ bật trong test T-205 để ghi Stream mỗi lần hold thành công    |

Redis không sẵn sàng hoặc script lỗi: `503 SEAT_HOLD_UNAVAILABLE`, `Retry-After: 1`; không log URL Redis/token/body. Redis dùng noeviction theo ADR-0002. Sau timeout kết quả có thể chưa xác định; client thử lại cùng ghế an toàn nhờ ownership check.

Key cùng hash tag `{evt:<eventId>}`: `seat:{evt:E}:<seatId>` = `H:<userId>` có TTL hoặc `S` không TTL; `hold:{evt:E}:<userId>` là Set có TTL; `hexp:{evt:E}` là ZSET member seatId/score expiry ms; `sold:{evt:E}` là Set do luồng bán quản lý (T-202 không sửa). Pub/Sub `delta:{evt:E}` phát `H:<seatId>` khi giữ và `A:<seatId>` khi nhả đúng chủ; `S:` thuộc luồng bán. Stream `holdlog:{evt:E}` chỉ tạo khi bật HOLDLOG_ENABLED, chứa holder, seat_ids JSON và expires_at ms, chỉ dùng kiểm chứng, không bật production.

Lua nằm trong `src/seat-hold/lua`, nạp bằng ioredis defineCommand (EVALSHA, fallback EVAL), được copy vào dist khi build. Kiểm tra xung đột/giới hạn/kiểu metadata trước khi ghi. Gia hạn một phần có thể khiến hold set chứa seat đã hết hạn: Lua chỉ đếm ghế còn thực sự thuộc user; dọn thành viên cũ sau khi batch được chấp nhận. Request bị từ chối không cleanup hay gia hạn bất kỳ key nào. Không KEYS/SCAN; đọc danh sách bằng hold set. Index hexp và Stream là metadata event, không đặt TTL theo từng user; thông báo hết hạn qua sweeper thuộc T-204.

Metrics có `seat_hold_requests_total{outcome="success|conflict|limit"}` và histogram HTTP hiện có; không dùng event/user/seat làm label. Integration dùng PostgreSQL + Redis `redis:7.4-alpine` Testcontainers (cùng tag hạ tầng dev), kiểm chứng qua HTTP/JWT và Pub/Sub/Stream thật. Concurrency dùng 100 kết nối Redis đã đồng bộ trước khi gửi; API test thêm 100 user HTTP khi Redis client vừa khởi tạo. Kết quả thật: [run report T-202](../../docs/agent/runs/T-202.md).
