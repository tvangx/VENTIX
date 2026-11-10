# Finance service — T-402

Cổng 3009; chỉ dùng finance_db qua finance_user. Consume OrderConfirmed, RefundCompleted, lifecycle và AuditRecorded qua @ticketing/outbox-inbox. Không đọc DB service khác.

## Chạy local

```bash
make up && make verify
cp services/finance/.env.example services/finance/.env
# Điền INTERNAL_API_KEY giống event-service; không commit .env.
pnpm --filter @ticketing/finance exec prisma migrate deploy
pnpm --filter @ticketing/finance dev
```

Prisma CLI cần DATABASE_URL trong environment hoặc services/finance/.env. Migration tạo bằng migrate dev --create-only, sửa tay constraint/trigger. Dev role không có quyền tạo shadow database: tạo migration trong PostgreSQL Testcontainer riêng, không nâng quyền role local. Integration đã kiểm tra migration từ DB rỗng bằng finance_user và role runtime NOSUPERUSER. Không sửa migration đã áp dụng.

FINANCE_WORKERS_ENABLED=true bật consumer, Outbox relay, collector DLQ, prefetch và replay relay. Mặc định schema false để export OpenAPI/test không cần Kafka; .env.example đặt true cho chạy thực tế. Khi bật bắt buộc có INTERNAL_API_KEY (tối thiểu 16 ký tự). KAFKA_BROKERS, EVENT_SERVICE_URL, FINANCE_POLL_MS nằm trong env schema. Kafka phải có topic hợp đồng và .dlq tương ứng; script infra hiện có đã tạo đủ. Health, metrics, Swagger, JWT và lỗi problem+json theo template chung.

## Sổ cái và VAT

- Mỗi sale/refund có header duy nhất (order_id, kind) và nhóm entry cùng txn_id. DB CHECK chặn tiền âm, ghi đồng thời cả hai bên và account ngoài danh sách. Constraint trigger DEFERRABLE INITIALLY DEFERRED kiểm tra cân bằng và từ chối nhóm rỗng tại commit.
- Header giữ created_xid, được trigger gán từ pg_current_xact_id(). Chỉ transaction tạo header được thêm entry; sau commit không nối thêm entry vào nhóm cũ. Header có trigger chặn UPDATE/DELETE/TRUNCATE.
- ledger_entries và audit_logs thu hồi UPDATE/DELETE/TRUNCATE của finance_user, kèm trigger chặn sửa/xóa/truncate. Role owner/superuser có thể thay DDL; ứng dụng không chạy bằng superuser. Quyền DDL phải được quản trị riêng.
- VAT_RATE_TICKET=0.10, VAT_RATE_MERCH=0.10 là **giả định phát triển**, cần xác nhận với quy định thuế hiện hành trước khi dùng trong báo cáo thật. Đây không phải báo cáo thuế hoàn chỉnh.
- Rate là tỷ lệ 0–1, tối đa bốn chữ số thập phân. Tách thuế theo tổng từng category/order bằng BigInt: net = round_half_up(gross * 10000 / (10000 + rate_bps)), vat = gross - net. Luôn net + vat = gross. Ví dụ gross 110 VND, rate 0.10: net 100, VAT 10.
- Theo quyết định Tuấn, chỉ chấp nhận PRICES_INCLUDE_VAT=true; false fail-fast. OrderConfirmed mô tả tiền thực thu đã thanh toán, không cộng VAT lên số phải thu (ADR-0012).
- Refund dùng snapshot item, VAT và số tiền đã ghi tại sale; không tính lại bằng cấu hình hoặc seat map hiện tại. Ghi bút toán đảo, đặt reversed_at, trừ stats cùng transaction.
- Refund sai tổng hoặc khác payment: không đảo, ghi AuditRecorded cảnh báo qua Outbox. Refund đến trước confirm được giữ trong pending_refunds; đơn chưa từng confirm (ví dụ late payment) không tạo doanh thu và có thể còn pending để đối soát.

## Snapshot và thứ tự message

events_ref lấy tenant/title từ lifecycle snapshot có version. Event cũ không ghi đè snapshot mới; v1 EventUpdated thiếu title chỉ kiểm tra snapshot tồn tại, không đổi tenant/title. Event SEATED được worker prefetch API nội bộ /v1/internal/events/{eventId}/seat-classes phân trang, lưu mapping vào DB finance. Không sửa API/event contract. Chỉ đặt pricing_ready sau khi kiểm tra toàn bộ trang và snapshot version vẫn khớp. Thiếu snapshot/map: handler rollback cả Inbox và dữ liệu, retry rồi vào DLQ; ADMIN replay khi đủ dữ liệu.

Advisory lock theo order serialize confirm/refund giữa các topic. Inbox chặn cùng message_id; fingerprint order và unique header chặn business duplicate có message_id khác. Read-model, ledger và revenue thay đổi cùng transaction. Stats API đọc REPEATABLE READ cho tenant và cả hai bảng stats.

## API bàn giao

Xem [openapi.json](./openapi.json) hoặc [finance.yaml](../../docs/api/finance.yaml). Tiền VND và audit id bigint trả bằng **chuỗi số nguyên**, tránh mất chính xác ở dashboard.

| Endpoint                            | Quyền                                            | Kết quả                                                                       |
| ----------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| GET /v1/organizer/events/{id}/stats | ORGANIZER đúng organizer_id trong JWT hoặc ADMIN | event_id, title, sales[], revenue[]                                           |
| GET /v1/admin/audit                 | ADMIN                                            | items, next_cursor; cursor id tăng dần, limit 1–200, lọc action/resource_type |
| GET /v1/admin/audit/verify          | ADMIN                                            | ok, checked, first_broken_id?                                                 |
| GET /v1/admin/dlq                   | ADMIN                                            | items, next_cursor; cursor UUID, payload/key/headers base64                   |
| POST /v1/admin/dlq/{id}/replay      | ADMIN                                            | REPLAY_PENDING rồi REPLAYED; gọi lại cùng trạng thái                          |
| POST /v1/admin/dlq/{id}/discard     | ADMIN                                            | DISCARDED; gọi lại an toàn                                                    |

POST replay/discard idempotent theo id dead letter. Không cho discard khi replay đã bắt đầu hoặc replay sau discard. Replay payload sai schema trả 409: sửa producer và phát event hợp lệ, không sửa raw evidence. Relay dùng dlq_replays như Outbox riêng trong DB, giữ nguyên từng byte payload/key/header và message_id; chỉ đánh dấu published sau Kafka ack. Crash giữa ack và commit có thể phát trùng, Inbox chặn. Không xóa Inbox để ép chạy lại nghiệp vụ đã hoàn tất.

Audit serialize bằng pg_advisory_xact_lock(402,1) trước sequence và đọc tip. JSON chuẩn hóa sắp xếp key đệ quy, giữ thứ tự array; hash gồm id, message_id, nghiệp vụ và created_at UTC mili giây. Verify đối chiếu cả cột SQL và record canonical. Genesis là 64 ký tự 0. Chưa có anchor ngoài DB: superuser có thể viết lại toàn chuỗi hoặc cắt đuôi mà nội bộ không chứng minh lịch sử ban đầu. Verify hiện quét toàn bộ chain.

## Kiểm chứng

```bash
pnpm --filter @ticketing/finance lint
pnpm --filter @ticketing/finance typecheck
pnpm --filter @ticketing/finance test
pnpm --filter @ticketing/finance test:int
pnpm --filter @ticketing/finance test:conc
pnpm --filter @ticketing/finance openapi:export
pnpm format:check && pnpm build
```

Docker test dùng image sẵn có postgres:16 và apache/kafka:3.8.0. Chạy tuần tự script có prisma generate trên Windows để tránh tranh chấp engine. Prefetch test dùng HTTP server giả theo hợp đồng; Kafka/PostgreSQL dùng Testcontainers thật. Metric finance_messages_total đếm handler trước commit (không dùng tính doanh thu), finance_worker_errors_total, metric Outbox và HTTP có sẵn. Log worker có request_id/trace_id, không log payload/token.

## Schema và giới hạn

Schema Prisma và migration là mô hình chi tiết finance. invoices/invoice_items đã có cho S-505; chưa có logic hóa đơn. Không làm payouts, SSE [C], partial refund hoặc hoàn tiền resale. Frontend polling REST theo V-502. Xem [ADR-0012](../../docs/adr/0012-finance-ledger-vat-audit.md) và [run report](../../docs/agent/runs/T-402.md).
