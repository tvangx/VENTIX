# Event service

T-208 bổ sung `GET /v1/events/{id}/seats?seat_map_version=…&cursor=…&limit=…`: chỉ event PUBLISHED và map đã publish, trả UUID ghế cùng hạng vé/zone/block/hàng/số. Limit mặc định 1000, tối đa 5000; cursor là UUID cuối trang. Browser dùng ánh xạ này để gọi Booking holds, không truy cập endpoint internal. Tuấn duyệt hợp đồng tại ADR-0019; không đổi DB/Kafka.

Tạo từ `services/_template` (xem `docs/dev/new-service.md`).

## Chạy local

```bash
cp .env.example .env      # không commit .env
make up                   # từ thư mục gốc repo (Postgres, Kafka, Redis...)
pnpm --filter @ticketing/event dev
curl localhost:3002/health/ready
```

## Lệnh

| Lệnh                      | Việc                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `dev` / `build` / `start` | chạy watch / biên dịch / chạy bản build                       |
| `lint` / `typecheck`      | ESLint / tsc                                                  |
| `test`                    | unit (`src/**/*.spec.ts`)                                     |
| `test:int`                | integration, Testcontainers (cần Docker)                      |
| `test:conc`               | concurrency (`test/concurrency/*.conc-spec.ts`)               |
| `openapi:export`          | ghi `openapi.json` (commit file này)                          |
| `prisma:migrate:create`   | `prisma migrate dev --create-only --name <mô_tả>` rồi sửa SQL |

## Có sẵn

`/health/live`, `/health/ready` (kiểm tra DB), `/metrics`, `/docs` (Swagger), log JSON có `request_id`/`trace_id`,
lỗi `application/problem+json`, JWT RS256 qua `@ticketing/auth-guard` (mặc định mọi route cần token; dùng `@Public()` để mở).
OpenTelemetry chỉ bật khi đặt `OTEL_EXPORTER_OTLP_ENDPOINT`.

`GET /v1/whoami` là endpoint mẫu: xóa khi viết module thật.

## S-107 — Schema và migration

Chín bảng nghiệp vụ theo architecture-v2 mục 5.2: venues, events, ticket_classes,
sale_phases, seat_maps, zones, blocks, seats, event_approvals; thêm Outbox/Inbox
chuẩn. ERD và quyết định ràng buộc ở `docs/erd/event.md`.

```bash
pnpm --filter @ticketing/event prisma:migrate:deploy
pnpm --filter @ticketing/event exec prisma generate
pnpm --filter @ticketing/event test:int
```

Dùng event_user/event_db riêng; organizer_id và admin_id không có FK sang Identity.
Client Prisma sinh trong generated/client của Event để không ghi đè Identity.
Migration có CHECK thời gian/trạng thái/giá/capacity, FK ghép bảo vệ event của ghế,
unique tọa độ ghế và version map. Map đã publish và hierarchy không được thay đổi
(SQL trigger, serialize theo event). CRUD/validate layout/sinh 10k ghế nằm ở tuần 2.

Testcontainers postgres:16 là mặc định. TEST_DATABASE_URL cho phép kiểm thử trên
PostgreSQL riêng với event_user có CREATEDB; mỗi suite tạo/xóa đúng DB ngẫu nhiên
của mình. Rollback `prisma/rollback/event-init.sql` xóa dữ liệu Event, chỉ chạy khi
đã xác nhận DB kiểm thử đích. Không tự chạy rollback trên DB có dữ liệu thật.

## S-201 — Quản lý sự kiện của Organizer

Gửi JWT có role `ORGANIZER` và claim `organizer_id`. Các API quản trị lấy tenant
từ JWT. Tài nguyên của tenant khác trả 404.

| Tài nguyên | Đường dẫn collection                            |
| ---------- | ----------------------------------------------- |
| Địa điểm   | `/v1/organizer/venues`                          |
| Sự kiện    | `/v1/organizer/events`                          |
| Hạng vé    | `/v1/organizer/events/{eventId}/ticket-classes` |
| Đợt mở bán | `/v1/organizer/events/{eventId}/sale-phases`    |

Qua Kong, thêm tiền tố `/api/event`. Mỗi collection có GET danh sách và POST tạo.
Thêm `/{id}` để GET chi tiết, PATCH hoặc DELETE. GET danh sách nhận `limit` từ 1
đến 100 (mặc định 20) và `cursor` từ `next_cursor` của trang trước. Tham khảo
Swagger `/docs` hoặc `openapi.json` để xem cấu trúc request và response.

- POST, PATCH và DELETE cần `Idempotency-Key` là UUID. Gửi lại cùng yêu cầu và
  key trả lại kết quả ban đầu. Đổi yêu cầu với cùng key trong tenant trả 409.
- PATCH gửi `version` hiện tại trong JSON cùng các trường cần đổi. DELETE gửi
  `?version=<version>`. Phiên bản cũ hoặc tài nguyên còn tham chiếu trả 409.
- Chỉ sửa/xóa sự kiện và ghi hạng vé, đợt mở bán ở DRAFT hoặc REJECTED. Sửa địa
  điểm bị chặn khi có sự kiện gắn với địa điểm ở trạng thái khác.

Khi nâng cấp dữ liệu S-107, migration tự gán venue cho Organizer nếu tất cả sự
kiện gắn với venue thuộc cùng tenant. Nếu venue chưa có sự kiện hoặc được nhiều
tenant dùng, migration rollback. Chủ dữ liệu cần đối chiếu và thống nhất cách
tách hoặc ánh xạ các venue đó trước khi thử lại.
File rollback `prisma/rollback/event-organizer-crud.sql` dùng cho bản sao kiểm thử đã xác nhận.

## S-202 — Seat map theo phiên bản

Organizer dùng `POST /v1/organizer/events/{eventId}/seat-maps` với JWT, tenant và
`Idempotency-Key` UUID. Sự kiện phải ở DRAFT hoặc REJECTED. Mỗi lần tạo sinh
version tiếp theo; API không cho sửa hoặc xóa map cũ. `GET` collection hỗ trợ
`limit`/`cursor`, `GET /{version}` trả layout của một version.

```json
{
  "layout": {
    "zones": [
      {
        "name": "A",
        "blocks": [
          {
            "name": "B1",
            "rows": [
              {
                "label": "R1",
                "seats": 10,
                "ticket_class_id": "00000000-0000-4000-8000-000000000001"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

Mỗi row sinh ghế đánh số từ 1 đến `seats`; tên zone trong map, tên block trong
zone và nhãn row trong block phải duy nhất. Mỗi row có 1 hạng vé SEATED thuộc
cùng event. Tổng ghế tối đa 100.000; mỗi row tối đa 1.000 ghế. Việc tạo map và toàn bộ hierarchy nằm trong một
transaction. S-203 đánh dấu `published_at` khi Organizer publish; trigger S-107
chặn mọi sửa/xóa map hoặc hierarchy đã publish.

### Khu đứng (GA) trong layout — issue #98

Layout có thêm `ga_areas` (tùy chọn) để khai báo khu đứng; khu đứng không sinh ghế:

```json
{
  "layout": {
    "zones": [],
    "ga_areas": [
      { "name": "Khu đứng A", "ticket_class_id": "00000000-0000-4000-8000-0000000000aa" }
    ]
  }
}
```

- `zones` được phép rỗng nhưng layout phải có ít nhất một zone hoặc một `ga_areas`
  (sự kiện toàn vé đứng); `zones` vẫn bắt buộc có trong body, `ga_areas` tối đa 100 phần tử.
- `ticket_class_id` phải thuộc event và có `kind = GA`, ngược lại `400 INVALID_GA_CLASS`.
  Hạng vé GA không được dùng trong row ghế (vẫn `400 INVALID_SEAT_CLASS`).
- Tên khu đứng không được trùng tên zone hoặc khu đứng khác (`400 DUPLICATE_SEAT_MAP_LABEL`);
  một hạng vé GA chỉ gắn một khu (`400 DUPLICATE_GA_CLASS`).
- Layout lưu nguyên dạng JSON trong `seat_maps.layout` nên không có migration; layout cũ không
  có `ga_areas` vẫn hợp lệ.
- Publish: event có vé SEATED giữ luồng cũ. Event chỉ có GA mà map mới nhất có `ga_areas` thì
  map được đánh dấu `published_at` để catalog công khai trả `seat_map`, nhưng `EventApproved`
  vẫn mang `seat_map_version=0` (booking không có ghế để prefetch giá).

### Vị trí và hình dạng (issue #106)

Tất cả trường dưới đây là tùy chọn:

```json
{
  "canvas": { "width": 1000, "height": 1000 },
  "stage": { "shape": "rect", "x": 400, "y": 900, "width": 200, "height": 60 },
  "zones": [],
  "ga_areas": [
    {
      "name": "Fanzone",
      "ticket_class_id": "<uuid hạng GA>",
      "position": {
        "shape": {
          "polygon": [
            [350, 700],
            [650, 700],
            [500, 850]
          ]
        }
      }
    }
  ]
}
```

- `canvas`: gốc trên-trái, trục y hướng xuống, mỗi cạnh trong `(0, 10000]`; bắt buộc nếu có
  `stage` hoặc `position`.
- `stage`, `zones[].blocks[].position`, `ga_areas[].position`: `shape` là `rect` hoặc `ellipse`
  (kèm `x`, `y`, `width`, `height`, tùy chọn `rotation` từ -360 đến 360) hoặc
  `{ "polygon": [[x, y], …] }` (3–50 đỉnh).
- `rotation` tính bằng độ, theo chiều kim đồng hồ, quanh tâm khung. Server kiểm khung trước khi
  xoay nằm trong `canvas`; không kiểm chồng lấn.
- Mọi Khu (`zones[].blocks[]`) và khu đứng đều có `position`, hoặc không cái nào có
  (`400 PARTIAL_PLACEMENT`). `stage` không tính vào quy tắc này.
- Sai canvas, hình dạng hoặc vượt canvas: `400 INVALID_PLACEMENT`.
- Vị trí không ảnh hưởng ghế được sinh ra; không có migration, layout cũ vẫn hợp lệ.

## S-203 — Duyệt và công khai sự kiện

| Vai trò   | Endpoint                                            | Chuyển trạng thái                           |
| --------- | --------------------------------------------------- | ------------------------------------------- |
| Organizer | `POST /v1/organizer/events/{id}/submit`             | DRAFT hoặc REJECTED → PENDING               |
| Admin     | `GET /v1/admin/events`, `GET /v1/admin/events/{id}` | Danh sách chờ duyệt và cấu hình để kiểm tra |
| Admin     | `POST /v1/admin/events/{id}/decision`               | PENDING → APPROVED hoặc REJECTED            |
| Organizer | `POST /v1/organizer/events/{id}/publish`            | APPROVED → PUBLISHED                        |
| Organizer | `POST /v1/organizer/events/{id}/cancel`             | Trạng thái chưa kết thúc → CANCELLED        |

Các lệnh POST nhận `version` hiện tại và `Idempotency-Key` UUID. Từ chối và
hủy cần lý do. Quyết định Admin được ghi vào `event_approvals`. Admin duyệt
xong, Organizer mới có thể chủ động publish. Lịch mở bán vẫn do sale phase
quyết định.

Publish cần hạng vé và sale phase. Event có vé SEATED phải có bản đồ phiên
bản mới nhất khớp các hạng vé ghế. Event chỉ có GA dùng `seat_map_version=0` (sơ đồ khu đứng nếu có vẫn được publish để hiển thị).
Việc đánh dấu seat map, chuyển PUBLISHED và ghi `EventApproved` v2 xảy ra
cùng transaction. Event đã công khai khi hủy sẽ ghi `EventCancelled` v2.
Hủy trước công khai chỉ đổi trạng thái Event. Booking xử lý dừng bán và T-401
phụ trách hoàn tiền. `EventUpdated` đi cùng luồng sửa sau duyệt đã hoãn.

Outbox relay dùng `KAFKA_BROKERS` (mặc định `localhost:9092`) và
`EVENT_OUTBOX_ENABLED`. Relay mặc định bật cho dev/prod, tắt cho test. Relay
đọc `outbox_events` và gửi topic `event.lifecycle` với key ID sự kiện. Các
metric `outbox_relay_*` xuất qua `/metrics`.

## S-204 — Catalog sự kiện công khai

`GET /v1/events` và `GET /v1/events/{id}` là API public cho sự kiện
`PUBLISHED`. Qua Kong dùng tiền tố `/api/event`. API chi tiết trả địa điểm,
hạng vé, đợt mở bán và seat map đã publish mới nhất.

| Query list                       | Hành vi                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `q`                              | Tìm chuỗi trong tiêu đề, tên hoặc địa chỉ địa điểm. Không phân biệt hoa/thường.                                                                  |
| `start_from`, `start_before`     | Lọc `start_at` trong khoảng nửa mở. Truyền ISO 8601 có múi giờ, ví dụ `2026-12-19T00:00:00+07:00`.                                               |
| `min_price_vnd`, `max_price_vnd` | Lọc khoảng giá **từ** của sự kiện, bao gồm hai mốc. Event chưa có hạng vé không khớp khoảng giá.                                                 |
| `sale_status`                    | `ON_SALE` khi có đợt đang mở, `UPCOMING` khi chưa mở hiện tại nhưng có đợt tương lai, `CLOSED` trong các trường hợp còn lại.                     |
| `sort`                           | `id` mặc định, `start_at` theo ngày tăng dần, hoặc `price_asc` theo giá từ tăng dần. Cùng giá/ngày dùng ID để phân thứ tự. Chưa có giá xếp cuối. |
| `limit`, `cursor`                | Mặc định 20, tối đa 100. Gửi nguyên `next_cursor` và giữ filter/sort tới trang kế. Bỏ cursor khi đổi filter/sort.                                |

Card trả thêm `venue_name`, `venue_address`, `min_ticket_price_vnd`,
`next_sale_starts_at`, `sale_status` và `sale_queue_enabled`. Giá là giá
niêm yết thấp nhất của các hạng vé. Giá và mốc kế tiếp có thể là `null`.
Hàng chờ lấy theo đợt hiện tại, hoặc đợt kế tiếp nếu chưa mở. Trạng thái dựa
trên lịch mở bán và chưa bao gồm tồn vé thực tế hoặc trạng thái sàn resale.
Thứ tự mặc định dùng cursor UUID hiện có. Hai kiểu sắp xếp mới cấp cursor
chứa mốc đã trả để phân trang tiếp khi sự kiện mốc bị hủy. Client chuyển
nguyên chuỗi qua query đã được mã hóa URL.

Cả hai API trả `ETag` và hỗ trợ `If-None-Match`/304. Client cần kiểm tra lại với
server (`Cache-Control: public, no-cache`). Dữ liệu được cache Redis 30–45 giây
với mutex ngắn hạn và gom yêu cầu đồng thời. Trước khi trả cache hoặc 304,
service xác minh `PUBLISHED` trong event_db để cache cũ không lộ sự kiện đã hủy.
Redis lỗi thì đọc PostgreSQL. `REDIS_URL` mặc định `redis://localhost:6379`;
local compose dùng `redis://localhost:16379`. Metric
`event_catalog_cache_requests_total{result="hit|miss"}` cho biết hiệu quả cache.
List tính trạng thái mở bán từ lịch đã cache ở thời điểm trả kết quả. Request
có `sale_status` đi thẳng PostgreSQL để lọc trước khi phân trang.

## Dữ liệu mẫu (S-205)

Sau khi migrate Event database local, đặt DATABASE_URL của Event trong
services/event/.env hoặc biến môi trường, rồi chạy:

```sh
pnpm --filter @ticketing/event seed
```

Có thể chạy pnpm seed ngay trong services/event. Lệnh tạo ba sự kiện
giả lập đã publish, gồm một sự kiện 10.000 ghế chia hai hạng vé. Mỗi
sự kiện có địa điểm, hạng vé và đợt mở bán. Lệnh dùng ID cố định cho
fixture và giữ nguyên dữ liệu của các sự kiện đã tồn tại khi chạy lại.
Publish ghi sự kiện vào Outbox của Event để relay hiện có phát lên Kafka.

## API nội bộ hạng vé theo ghế (S-206)

Booking gọi trực tiếp GET /v1/internal/events/{eventId}/seat-classes
với header X-Internal-Key. Cấu hình INTERNAL_API_KEY giống nhau ở Event
và Booking để bật luồng này. Thiếu cấu hình hoặc khóa sai trả 401.
Kong dùng cấu hình T-206 trên main để trả 404 với đường dẫn nội bộ từ ngoài.

Giữ seat_map_version của snapshot khi đọc các trang tiếp theo. Nếu
không truyền phiên bản, Event chọn seat map đã publish mới nhất. Mỗi
trang mặc định 1.000 ghế, tối đa 5.000. Dùng next_cursor của trang trước
cho tới khi nhận null. Hợp đồng xem tại
[seat-classes.yaml](../../docs/api/internal/seat-classes.yaml).
