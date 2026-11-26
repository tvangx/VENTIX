# payment-service (T-302, T-303, T-405)

T-208: `VNPAY_PAYMENT_URL` được validate bằng allowlist HTTPS hai endpoint sandbox. Mặc định giữ `sandbox.vnpayment.vn`; overlay demo chọn rõ `https://sandbox.vnpaytest.vn/paymentv2/vpcpay.html` theo thông tin Tuấn cấp. Không suy đoán hai hostname tương đương. Return frontend `/payments/return` chỉ hiển thị trạng thái đọc từ Booking; IPN vẫn kiểm chữ ký trước ghi kết quả. Không nhập secret sandbox vào repo.

Tạo link thanh toán VNPay sandbox hoặc mock từ read-model `payables` cục bộ. Cổng dev 3004.
Inbox dựng payable từ `OrderAwaitingPayment` (ORDER) và `ResaleOrderAwaitingPayment` (RESALE)
trong cùng transaction; chỉ đọc DB payment. Consumer subscribe `booking.orders` và `resale.events`.

## Chạy local

```bash
make up && make verify
cp services/payment/.env.example services/payment/.env
# Cập nhật cấu hình local; không commit .env.
cd services/payment
pnpm exec prisma migrate deploy
pnpm dev
```

`PAYMENT_WORKERS_ENABLED=true` bật consumer `payment-payables`, Outbox relay và mock worker.
Runtime mặc định bật; test/OpenAPI tắt workers. Startup đợi Kafka sẵn sàng.
Có `/health/live`, `/health/ready`, `/metrics`, `/docs` từ template.

## API và idempotency

`POST /v1/payments` cần JWT RS256 và `Idempotency-Key` (1–200 ký tự ASCII hiển thị):

```json
{ "order_id": "11111111-1111-4111-8111-111111111111", "provider": "MOCK" }
```

Đơn resale dùng `{ "resale_order_id": "11111111-1111-4111-8111-111111111111", "provider": "MOCK" }`.
Phải gửi đúng một trong `order_id` và `resale_order_id`; gửi cả hai hoặc không gửi khóa nào
trả 422 `INVALID_PAYMENT_REFERENCE`. UUID/provider sai hoặc trường dư trả 400.
Buyer của resale phải khớp JWT; payable lấy từ sự kiện, bao gồm event, tiền và hạn thanh toán.
Khóa payable và active payment theo `(purpose, ref_id)` nên hai loại đơn có cùng UUID vẫn độc lập.

Trả HTTP 201 `{ "redirect_url": "..." }`. Chủ đơn phải khớp JWT; giá, event, expiry lấy từ payable.
Chưa có payable: 409 `ORDER_NOT_READY`, `Retry-After: 1`; hết hạn: 409 `PAYABLE_EXPIRED`.
Cùng key/user/body trả URL đã lưu, kể cả khi payment đã kết thúc hoặc payable đã hết hạn.
Cùng key đổi user/reference/purpose/provider: 422 `IDEMPOTENCY_KEY_REUSED`.
Fingerprint ORDER giữ tương thích payment đã tạo trước T-405.
Sau FAILED dùng key mới để thử lại; PENDING/SUCCEEDED chặn key mới bằng 409 `PAYMENT_ALREADY_ACTIVE`.
Khóa hàng payable và partial unique index `(purpose,ref_id)` với trạng thái PENDING/SUCCEEDED bảo vệ D7.
Tiền phải dương và là số nguyên an toàn; VNPay giới hạn 12 chữ số sau nhân 100.

`GET /v1/payments/vnpay/ipn` public, xác thực bằng HMAC trước truy vấn payment; đối chiếu provider và
amount. Transaction ghi payment_transactions, chuyển trạng thái có version và Outbox kết quả.
Callback trùng không phát thêm event. Raw payload chỉ lưu mã phản hồi/kết quả/mã giao dịch, không lưu
chữ ký hoặc dữ liệu ngân hàng. `provider_txn_id` có namespace provider; mã 0 của giao dịch thất bại
được gắn payment_id để tránh va chạm giữa các lần thử. Event giữ mã gốc nhà cung cấp.

`GET /v1/payments/vnpay/return` chỉ trả `{signature_valid,provider_succeeded}` để hiển thị;
không cập nhật DB. Kết quả cuối cùng chờ IPN.

## VNPay sandbox: đối chiếu giao thức

Nguồn chính thức đọc ngày 2026-11-06:
[Thanh toán PAY v2.1.0](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html),
bảng khởi tạo, bảng IPN/Return, demo Node/PHP và phần retry IPN.

| Tham số                                       | Giá trị/quy tắc                                       |
| --------------------------------------------- | ----------------------------------------------------- |
| `vnp_Version`, `vnp_Command`                  | `2.1.0`, `pay`                                        |
| `vnp_TmnCode`                                 | VNPAY_TMN_CODE, 8 ký tự chữ/số                        |
| `vnp_Amount`                                  | amount_vnd × 100, chuỗi số tối đa 12 chữ số           |
| `vnp_CurrCode`, `vnp_Locale`, `vnp_OrderType` | VND, vn, other                                        |
| `vnp_TxnRef`                                  | UUID payment bỏ dấu gạch ngang, duy nhất mỗi lần thử  |
| `vnp_OrderInfo`                               | Thanh toan + payment ref; ASCII không dấu             |
| `vnp_IpAddr`                                  | socket IP, không tin X-Forwarded-For do client tự gửi |
| `vnp_CreateDate`, `vnp_ExpireDate`            | yyyyMMddHHmmss GMT+7; expiry đúng payable             |
| `vnp_ReturnUrl`                               | VNPAY_RETURN_URL                                      |
| `vnp_BankCode`                                | Không gửi: khách chọn ngân hàng tại VNPay             |
| `vnp_SecureHash`                              | HMAC-SHA512 hex; khóa chỉ từ env                      |

Sắp xếp tên tham số tăng dần, encodeURIComponent từng key/value, đổi `%20` thành `+`, ghép bằng `&`.
Ký và gửi chính chuỗi đã mã hóa, không encode lần hai (theo demo Node).
Verify loại SecureHash/SecureHashType, canonicalize lại dữ liệu đã parse một lần, so digest hằng thời gian.
Từ chối array/object, hash sai định dạng, sai merchant, amount/date/ref không hợp lệ.
Kiểm cả BankCode, OrderInfo, TransactionNo theo bảng. Thành công cần ResponseCode và TransactionStatus
đều bằng 00. PayDate tùy chọn theo tài liệu: nếu vắng dùng thời điểm server nhận; nếu có phải là ngày
GMT+7 hợp lệ. Qua reverse proxy, socket IP là IP proxy; cần cấu hình trust proxy riêng trước khi dùng
IP client từ header. Hiện service không tin header chưa xác thực.

IPN luôn HTTP 200, JSON `{RspCode,Message}`:

| RspCode | Ý nghĩa                            |
| ------- | ---------------------------------- |
| 00      | Cập nhật thành công                |
| 01      | Không có payment hoặc sai provider |
| 02      | Payment đã xử lý                   |
| 04      | Sai số tiền                        |
| 97      | Chữ ký hoặc payload không hợp lệ   |
| 99      | Lỗi xử lý; VNPay cần thử lại       |

Theo tài liệu 00/02 kết thúc; 01/04/97/99 hoặc timeout kích hoạt retry.
VNPAY_IPN_URL được đăng ký tại quản trị sandbox; không thêm `vnp_IpnUrl` vào PAY vì bảng tham số
không có trường đó. Bốn VNPAY_* để rỗng trong env mẫu; VNPAY_ENABLED=true đòi cấu hình đầy đủ.

Tuấn chạy E2E thật: bật `cloudflared tunnel --url http://localhost:3004`, đăng ký
`https://<tunnel>/v1/payments/vnpay/ipn`, đặt Return URL theo ứng dụng hoặc endpoint verify ở trên.
Nhập credentials sandbox vào env local, bật VNPAY_ENABLED, dựng payable qua booking/Kafka,
tạo payment VNPAY, thanh toán bằng thẻ test chính thức rồi đối chiếu DB/outbox. Không gửi secret qua PR/log.

## Mock

URL `https://mock.invalid/payments/<id>` là URL giả, không cần mở để hoàn tất payment.
Delay ngẫu nhiên trong khoảng đóng `[MOCK_DELAY_MS,MOCK_MAX_DELAY_MS]`, mặc định 1000–3000 ms.
MOCK_SUCCESS_RATE trong [0,1], mặc định 0.95. MOCK_OUTCOME=SUCCESS/FAILURE cho test xác định,
RANDOM cho demo; MOCK_DUPLICATE_IPN=true gọi IPN nội bộ hai lần.
Kết quả và dueAt lưu trong payments.mock_data cùng transaction tạo link. Worker poll 100 ms,
restart tiếp tục PENDING đã đến hạn; hai replica có thể cùng gọi, DB chống xử lý đôi.
Delay có thể vượt expiry để mô phỏng late payment. Payment ghi nhận kết quả cổng;
booking quyết định bù trừ ở T-303/T-401. Không có endpoint mock IPN public.

## Kiểm chứng và phạm vi

```bash
pnpm --filter @ticketing/payment lint
pnpm --filter @ticketing/payment typecheck
pnpm --filter @ticketing/payment test
pnpm --filter @ticketing/payment test:int
pnpm --filter @ticketing/payment test:conc
pnpm --filter @ticketing/payment openapi:export
pnpm exec prettier --write services/payment/openapi.json
pnpm format:check && pnpm build
```

Unit có vector Python hmac/hashlib độc lập. Integration/concurrency dùng PostgreSQL thật;
luồng worker dùng Kafka thật trong Testcontainers. Cần Docker; dùng lại image có sẵn trong repo.
DB có sáu bảng nghiệp vụ theo ERD cùng Outbox/Inbox. Payables giữ PK kép và thêm UUID unique.
T-401 bổ sung refund toàn phần cho ORDER; reconciliation payment độc lập vẫn ngoài phạm vi này.
Resale dùng chung IPN, mock worker và Outbox với ORDER; sự kiện kết quả có
`purpose=RESALE`, `resale_order_id` và không có `order_id`.
Booking consumers, expiry sweeper, bù trừ thuộc T-303.
T-302 có callback payment cần để mock/adapter hoàn tất và phát kết quả an toàn.
Metric payment_callback_total, HTTP duration và Outbox relay xuất qua `/metrics`.

T-303 kiểm chứng thêm IPN VNPay gửi 3 lần: lần đầu RspCode=00, hai lần sau
RspCode=02, chỉ một payment_transaction và một sự kiện Outbox. Chữ ký/số tiền sai
không thay đổi payment; provider_txn_id đã thuộc payment khác trả 99 và không trả
tiền nhầm order. Callback thất bại trùng cũng chỉ phát PaymentFailed một lần.
Định dạng phản hồi giữ theo [tài liệu chính thức VNPay](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html).
Booking xử lý success đến muộn và phát LATE_PAYMENT trong T-303; T-401 tự tạo refund khi nhận sự kiện này.

## T-401: hoàn tiền và kết quả không rõ

API JWT role ADMIN, tiền tố `/v1/admin`: `POST /refunds {order_id,reason}`, `POST /refund-batches {event_id,reason}`, `GET /refund-batches/{id}`, `GET /refunds?status=&cursor=`, `POST /refunds/{id}/retry`. POST cần Idempotency-Key; cùng key khác nội dung trả 422. Mỗi hành động thành công, kể cả GET/replay POST, phát AuditRecorded qua Outbox cùng transaction. Danh sách tối đa 50 dòng, có next_cursor; tiền trả chuỗi số nguyên VND. ADMIN không có organizer_id là admin toàn hệ thống; ADMIN có organizer_id bị giới hạn theo lifecycle snapshot trong payment DB, không tin X-Tenant-Id từ client. Lỗi dùng problem+json.

Consumer payment-refunds replay booking.orders và event.lifecycle qua Inbox. LATE_PAYMENT tạo một refund cho payment ORDER SUCCEEDED. EventCancelled v2 tạo batch tự động và refund cho mọi payment ORDER SUCCEEDED; callback đến sau batch dùng cùng khóa event nên cũng được đưa vào batch. Payable ORDER của event hủy bị đóng. Resale không bị đưa vào refund. Lifecycle sai tenant/owner/v1 vào DLQ; bản cũ không ghi đè snapshot mới. Không gọi DB booking/event.

Worker claim bằng SKIP LOCKED, commit dấu gửi/lease/token trước HTTP. refund_dispatch giới hạn concurrency và thời điểm bắt đầu request trên toàn bộ replica (cùng cấu hình). Retry có backoff lũy thừa, cap và jitter 50–100%; default tối đa 5 attempts. Thành công và RefundCompleted cùng transaction. Kết quả không rõ giữ dấu gửi, lên lịch đối soát có backoff qua cùng quota; không đủ chứng cứ thì NEEDS_MANUAL. Retry tay chỉ cho NEEDS_MANUAL, vẫn giữ dấu gửi. NOT_PERFORMED chỉ là bằng chứng chắc chắn từ mock, cho phép gửi lại; VNPay không tự gửi refund lại sau dấu gửi.

| Env                                       | Mặc định                                                     | Ý nghĩa                                            |
| ----------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| VNPAY_REFUND_ENABLED                      | false                                                        | Xác minh endpoint/quyền merchant trước khi bật EC2 |
| VNPAY_REFUND_URL                          | https://sandbox.vnpayment.vn/merchant_webapi/api/transaction | Allowlist JSON tham chiếu, độc lập payment URL     |
| VNPAY_REFUND_IP                           | 127.0.0.1                                                    | IP server ghi vào request                          |
| VNPAY_REFUND_TIMEOUT_MS                   | 10000                                                        | Timeout HTTP, gồm đọc body                         |
| REFUND_CONCURRENCY / REFUND_RATE_PER_SEC  | 5 / 5                                                        | Quota chung giữa replica, bao gồm query            |
| REFUND_MAX_ATTEMPTS                       | 5                                                            | Giới hạn đợt thử; retry tay mở đợt mới             |
| REFUND_LEASE_MS                           | 30000                                                        | Phải lớn hơn HTTP timeout                          |
| REFUND_BACKOFF_MS / REFUND_BACKOFF_MAX_MS | 1000 / 60000                                                 | Backoff lũy thừa có cap và jitter                  |
| MOCK_REFUND_FAILURE_RATE                  | 0                                                            | Tỷ lệ NOT_PERFORMED khi outcome RANDOM             |
| MOCK_REFUND_OUTCOME                       | SUCCESS                                                      | SUCCESS, FAILURE, RANDOM hoặc LOST_RESPONSE        |

Mock receipt lưu trong mock_refund_receipts bằng transaction độc lập để phục hồi sau restart. Metric refunds_total{status} đếm attempt sau commit (best effort); log có request_id/trace_id/refund_id/payment_id/batch_id. Tiến độ batch đọc DB, không suy từ counter. Refund đã có trước batch được gắn vào batch để không hoàn lần hai; RefundCompleted cũ không phát lại.

VNPay lấy RequestId từ refund.id bỏ gạch (32 ký tự), TransactionDate từ vnp_CreateDate trong redirect_url đã lưu từ T-302, không dùng paid_at thay thế. HMAC-SHA512 theo các trường phân cách `|`, khác chữ ký query-string payment. Chỉ refund toàn phần đã xác thực đúng liên kết/số tiền, code/status 00/00 mới hoàn tất. Query payment gốc 00 không chứng minh đã hoàn tiền; query hiện chưa đủ bảo đảm lookup refund nên phải đối soát tay. Chưa kiểm chứng merchant thực tế/E2E refund. Xem [ADR-0020](../../docs/adr/0020-refund-delivery-uncertainty.md), [nâng cấp T-208](../../docs/ops/t401-upgrade.md).

## Resale khi S-405 chưa sẵn sàng

Script chỉ dùng dữ liệu giả trong môi trường local, phát sự kiện đúng schema bằng `newMessage`.
Chạy từ workspace payment (để resolve các dependency đã có), Node 20:

```bash
cd services/payment
pnpm dev:publish-fake-resale-order
```

Các biến tùy chọn của script: `KAFKA_BROKERS` (localhost:9092), `FAKE_RESALE_ORDER_ID`,
`FAKE_LISTING_ID`, `FAKE_BUYER_ID`, `FAKE_EVENT_ID` (mặc định UUID ngẫu nhiên),
`FAKE_AMOUNT_VND` (125000), `FAKE_EXPIRES_IN_SECONDS` (900, tối đa 86400).
Script in các ID và expiry; đặt FAKE_BUYER_ID bằng user_id của JWT dùng tạo payment.
Kafka key là listing_id theo contracts. Replay snapshot không ghi đè hoặc mở lại payable đã đóng.

**Hạn chế đã biết:** chưa hỗ trợ hoàn tiền đơn resale theo ADR-0009 C7; chưa kiểm chứng
escrow/chuyển quyền vé với resale-service thực tế. Script giả không tạo listing/vé thật.

## Giám sát HTTP (T-404)

`/metrics` xuất histogram `http_server_request_duration_seconds{service,method,route,status_class}` thay tên HTTP cũ `http_request_duration_seconds`. Route là mẫu đăng ký; URL không khớp dùng `unmatched`, không gắn ID/raw URL vào nhãn. Middleware global ghi mỗi response hoàn tất một lần, bao gồm lỗi guard/filter và 404; lượt scrape không được tính. Metric nghiệp vụ và endpoint hiện có giữ nguyên.

Prometheus/Grafana, rollout backend và chặn metrics qua Kong: [runbook observability](../../docs/ops/observability.md). Không public `/metrics`.
