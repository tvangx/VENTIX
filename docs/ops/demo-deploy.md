# T-208 — nâng cấp demo từ hạ tầng c5003f5

Đây là bản demo, không thay thế T-403/T-505/T-601, nghiệm thu G2/G3, benchmark, chaos, giám sát hay backup drill. Agent chỉ chuẩn bị local; Tuấn chuyển file, nhập secret và chạy EC2/Cloudflare/VNPay. Không cần Git trên server.

## Khả năng hiện có

| Phần          | Khả năng / giới hạn                                                                                                                                                                                                                                                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web           | Đăng ký/đăng nhập thật, catalog/detail thật qua `/api/identity`, `/api/event`; chọn ghế → phòng chờ/admission → giữ ghế/checkout thật → provider VNPAY → sandbox → Return frontend `/payments/return` đọc trạng thái đơn → danh sách vé và mã TOTP từ Ticket API. UI triển khai ở T-208 mở rộng; mức kiểm chứng thực tế xem run report. |
| Backend       | Identity, Event, Booking, Payment, Ticket; Kafka workers/outbox, prefetch giá ghế, Waiting Room/admission bật; API giữ ghế/checkout/thanh toán/phát vé theo code hiện tại.                                                                                                                                                              |
| VNPay         | Chỉ sandbox, URL payment lấy từ VNPAY_PAYMENT_URL có allowlist hai sandbox; demo chọn endpoint sandbox.vnpaytest.vn được cấp. Return frontend không xác nhận thanh toán, chỉ đọc đơn; Return API JSON vẫn giữ để hỗ trợ. IPN mới ghi nhận kết quả. Refund adapter chưa triển khai (T-401): không demo thanh toán muộn/hủy/hoàn tiền.    |
| Ngoài phạm vi | Merch/combo/resale, email/thông báo, finance/payout, Google OAuth, KYC/OTP, upload/banner MinIO công khai, NFT. Không thử đơn có merch. KYC giữ mặc định chưa bật, không dùng sự kiện hot yêu cầu KYC.                                                                                                                                  |

Không thêm domain staging-api. Origin duy nhất `https://ventixxx.dpdns.org`, tunnel giữ `http://kong:8000`. Không mở port mới; không thay bảy data volume, password DB, subnet/IP trust connector hoặc token hiện có.

## Chuẩn bị trên Windows local

Từ nhánh/commit đã review, working tree sạch; Docker Desktop Linux amd64. Script dùng pnpm lockfile và Node 20.19.5 đã pull ghim digest; không push registry.

```powershell
powershell -NoProfile -File infra/deploy/package-demo.ps1 -Release demo-YYYYMMDD-<commit>
```

Script build lần lượt 6 image, `docker save`, gom **allowlist** runtime config/scripts/runbook, tạo `IMAGES`, `SOURCE_COMMIT`, `release.env`, `SHA256SUMS`, archive và checksum archive trong `dist/demo/`. Không ship .git, env thật hay source repo vào artifact; image chỉ chứa dist, runtime dependencies, Prisma/migration/tool cần chạy. Không thêm registry/token. Không dùng lại tag release. Giữ artifact cũ trên local và EC2 để rollback. Kiểm tra dung lượng trước khi chuyển: server 40 GiB phải đủ image + images.tar + archive + dữ liệu hiện có; không tự prune volume/image đang dùng.

## Secret do Tuấn nhập

Giữ nguyên `/etc/ticketing/.env.prod` và `/etc/ticketing/cloudflared-token`. Tạo `/etc/ticketing/.env.demo` từ `infra/deploy/demo.env.example` bằng editor trên server, chỉ chủ deploy đọc/ghi (0600). Không dán secret vào command history/log/chat/Git. Không export bằng `source` env (Compose đọc cú pháp dotenv).

- `DEMO_ORIGIN` giữ domain HTTPS trên.
- `JWT_PRIVATE_KEY_PEM`: PKCS8 RSA >=2048 bit, bền qua release; Compose single-quoted với literal `\n` giữa các dòng, Identity tự chuyển thành newline. Không dùng key dev, không xoay khóa trong upgrade/rollback.
- `INTERNAL_API_KEY` >=16 ký tự và `ADMISSION_TOKEN_SECRET` >=32 ký tự, giữ ổn định.
- `TICKET_ACTIVE_KEY_ID` và `TICKET_ENCRYPTION_KEYS`: single-quoted JSON key ring, mỗi key base64 chuẩn của 32 byte; giữ key cũ để đọc vé cũ. Không tự thay khi rollback.
- `VNPAY_TMN_CODE`: 8 ký tự chữ/số **sandbox**; `VNPAY_HASH_SECRET` lấy từ tài khoản sandbox. Không dùng tiền thật.

Password DB/Redis được lấy trực tiếp từ env infra lúc Tuấn chạy, wrapper encode URL an toàn cho ký tự đặc biệt, mỗi service đúng user/DB. Không cần copy lại password vào env demo. Schema service được validate trước migration/start, lỗi chỉ in tên field; Compose kiểm thiếu env bằng `:?`. Không chạy `compose config` thiếu `--quiet` vào log vì output có thể chứa secret.

Trong portal sandbox, cấu hình IPN `https://ventixxx.dpdns.org/api/payment/v1/payments/vnpay/ipn`. Return tự cấu hình `https://ventixxx.dpdns.org/payments/return` (route frontend thật). Backend `/api/payment/v1/payments/vnpay/return` chỉ là API kiểm chữ ký hỗ trợ. Cloudflare phải cho hai callback đi qua không có trang challenge/Access login/cache; Tuấn kiểm tra dashboard. Không tắt chữ ký/idempotency/auth để xử lý callback.

Đã đối chiếu [tài liệu PAY chính thức VNPay](https://sandbox.vnpayment.vn/apis/docs/thanh-toan-pay/pay.html) và [FAQ Return/IPN](https://sandbox.vnpayment.vn/apis/docs/faqs/): Return phục vụ hiển thị; IPN cập nhật giao dịch. Adapter dùng HMAC SHA512, tiền nhân 100. VNPAY_PAYMENT_URL giữ mặc định cũ để tương thích; overlay demo chỉ định `https://sandbox.vnpaytest.vn/paymentv2/vpcpay.html` theo email Tuấn cung cấp. Không giả định hai hostname là một hệ thống; giao dịch sandbox thật vẫn phải được Tuấn kiểm chứng bằng credential được cấp.

## Chuyển gói và nâng cấp trên EC2 (Tuấn chạy)

Chuyển `<release>.tar` và `.tar.sha256` qua kênh SSH đang dùng. Không clone repository. Các ví dụ dưới thay `<release>` bằng tên thật, không nhập ký tự `< >` vào shell.

```bash
cd /opt/ticketing
sha256sum --check <release>.tar.sha256
tar -tf <release>.tar # chỉ thư mục release và allowlist, không đường tuyệt đối/..
tar -xf <release>.tar
cd /opt/ticketing/<release>
sha256sum --check SHA256SUMS
bash infra/deploy/demo.sh check /etc/ticketing/.env.prod /etc/ticketing/.env.demo /etc/ticketing/cloudflared-token
bash infra/deploy/demo.sh upgrade /etc/ticketing/.env.prod /etc/ticketing/.env.demo /etc/ticketing/cloudflared-token
```

`check` load image và kiểm ID/platform/env/schema, không migration hoặc đổi daemon. `upgrade` chạy migration deploy lần lượt bằng user service rồi app healthy mới đổi Kong. Script dùng `ticketing-prod` và `--no-deps --pull never`: không recreate data services/connector, không reset/seed. Mọi migration lỗi trả exit nonzero và tên service; dừng kiểm tra, không `migrate reset`, `db push`, `resolve --applied` hoặc bỏ qua SQL. Migration đã commit có thay constraint/index Event, không đảo ngược SQL tự động. Giữ gateway hạ tầng nếu lỗi trước bước chuyển Kong; app đã đổi có thể cần rollback thủ công nếu lỗi giữa chừng.

Sau khi tạo app lần đầu, dừng sử dụng script deploy hạ tầng cũ để redeploy cả stack vì nó không biết overlay ứng dụng. Không chạy `down -v` hoặc `--remove-orphans`.

## Bootstrap dữ liệu có kiểm soát

Upgrade **không tự seed**. Identity cần bốn role; công cụ có sẵn `node prisma/seed.js` chỉ upsert role với `update: {}`. Event có `node dist/tools/seed.js`, chỉ tạo fixture chưa có, ghi lifecycle thật qua repository/outbox và không sửa sự kiện sẵn có. Không dùng seed S1/fake producer/load-test vào demo.

Tuấn có thể chạy hai lệnh sau **một lần khi cần dữ liệu mẫu**, dùng Compose đủ ba overlay/env như script; thay shorthand `APP` bằng array trong script hoặc đầy đủ lệnh (không có binary APP):

```bash
export CLOUDFLARED_TOKEN_FILE=/etc/ticketing/cloudflared-token
APP=(docker compose -p ticketing-prod --env-file /etc/ticketing/.env.prod --env-file /etc/ticketing/.env.demo --env-file "$PWD/release.env" -f infra/compose/docker-compose.prod.yml -f infra/compose/docker-compose.tunnel.yml -f infra/compose/docker-compose.apps.yml)
"${APP[@]}" run --rm --no-deps identity node prisma/seed.js
"${APP[@]}" run --rm --no-deps event node dist/tools/seed.js
```

Không ghi trực tiếp Booking/Payment/Ticket để tạo đơn/vé giả. Catalog rỗng trước seed là dữ liệu thật, không phải lỗi tích hợp. Event seed tạo sự kiện công khai và outbox; chờ Booking prefetch/consumer ready. Fixture cũ có thể đã hết hạn; không sửa seed để cưỡng ép mở bán trong T-208.

## Smoke và nghiệm thu riêng

Script kiểm loopback Kong `/`, `/health/infra`, `/api/<service>/health/ready`. Tuấn kiểm HTTPS cùng các URL, SPA refresh `/login`, `/events/<id>/seats`; `/api/event/v1/internal/...` phải 404, endpoint cần JWT phải 401 khi không có token; invalid VNPay IPN phải `RspCode=97`. Không công khai `/docs`, `/metrics`, database hoặc admin port để kiểm tra.

Trên browser HTTPS: đăng ký tài khoản mẫu, login, refresh trang, logout/login lại, catalog/detail/seat map thật; kiểm Network `/api/...` và cookie Secure/HttpOnly. Tiếp tục chọn ghế, đăng nhập khi được yêu cầu, vào phòng chờ, giữ ghế/tạo đơn và thanh toán VNPay sandbox. Sau redirect, Return frontend đọc GET /api/booking/v1/orders/{orderId}; chỉ CONFIRMED mới hiển thị đường xem vé. Mã đơn được lưu trong sessionStorage, không lưu JWT/admission vào storage; đổi browser/tab mất phiên mã đơn thì vào ví vé để kiểm tra. Backend smoke riêng theo OpenAPI có sẵn: join queue → status SSE cấp admission → seat-status snapshot/SSE → holds → checkout (Idempotency-Key) → payment provider VNPAY (chờ 409 ORDER_NOT_READY theo Retry-After) → mở redirect sandbox → IPN → vé qua API Ticket. Không coi Return hay redirect_url là bằng chứng vé đã phát hành. Không ghi JWT/admission/payment query thật vào báo cáo.

Kong tắt buffering route booking, read/write timeout 1 giờ; client SSE dùng Authorization header, không token query. Cloudflare cache bypass `/api/*` và SSE là bước Tuấn xác nhận dashboard. HTTPS sandbox và cookie sau Tunnel chỉ được đánh dấu đạt sau khi chạy thật trên EC2.

## Rollback giữ dữ liệu

Nếu đang ở bản demo trước đó: chuyển về **artifact cũ** đã giữ, dùng env/key/token hiện tại, chạy `check` rồi `rollback`. Script load/so ID image cũ, không migration; chỉ phù hợp khi schema mới tương thích code cũ. Không tự downgrade DB. Chưa chứng minh tương thích thì dùng `infra-only` để ngừng phục vụ nghiệp vụ và giữ dữ liệu chờ xử lý.

```bash
cd /opt/ticketing/<previous-release>
bash infra/deploy/demo.sh rollback /etc/ticketing/.env.prod /etc/ticketing/.env.demo /etc/ticketing/cloudflared-token
# Lần đầu c5003f5 chỉ có infra: dùng artifact demo hiện tại để dừng app, khôi phục Kong infra.
bash infra/deploy/demo.sh infra-only /etc/ticketing/.env.prod /etc/ticketing/.env.demo /etc/ticketing/cloudflared-token
```

`infra-only` stop 6 app, recreate riêng Kong với config infra và trust connector hiện có; cloudflared/data services giữ nguyên. Đối chiếu `/health/infra` và HTTPS. Image rollback không phải restore dữ liệu; backup/restore drill vẫn là T-601 chưa nghiệm thu.
