# T-205 — S1 baseline, 2026-11-06

**Chưa nghiệm thu G1.** Hai lượt 5.000 VU hoàn tất 5.000 iteration nhưng k6 thoát 99 vì lỗi kết nối. Verifier đều thoát 0, không có ghế được ghi giữ thành công hai lần và số thành công bằng số key ghế thực sự đang giữ. Đây là bằng chứng đúng đắn trên các request đã tới booking; chưa chứng minh hệ thống phục vụ đủ burst 5.000–10.000 người. Không thay số liệu bằng mục tiêu thiết kế.

## Môi trường thực đo

- Cùng máy chạy k6 Windows, **một replica booking trên host**, và Docker Desktop chứa Redis/PostgreSQL/Kong/Kafka. Không có máy phát tải thứ hai; không có các bài test khác chạy đồng thời lúc đo.
- Windows 11 Home Single Language 10.0.26300; AMD Ryzen 5 6600HS Creator Edition, 6 core/12 logical CPU; RAM vật lý 14.702.026.752 byte (~13,69 GiB). Docker được cấp 6 CPU, 10.429.898.752 byte (~9,71 GiB).
- Booking Node **20.20.2** (portable); pnpm 9.15.9; k6 **2.3.0**, windows/amd64, commit e088784614. Shell mặc định của máy có Node 24.16.0; riêng app và test công cụ xác nhận bằng Node 20.20.2.
- Redis `redis:7.4-alpine`, PostgreSQL `postgres:16-alpine`, Kong `kong:3.8`, Kafka `apache/kafka:3.8.0`; mỗi thành phần một container dev. Không thêm image/dependency.
- `HOLDLOG_ENABLED=true`, `HOLD_TTL_SECONDS=3600`, `HOLD_MAX_SEATS=6`, `ADMISSION_REQUIRED=false`; consumer lifecycle và rehydrate bật. Log booking mức info, telemetry không bật.
- Fixture là event UUID mới trong **booking_db bằng booking_user**, APPROVED, cửa sổ bán mở, pricing_ready=true, giống fixture T-202. Chỉ phục vụ hold Redis; không đo prefetch T-203b, checkout, thanh toán, unique index hay Redis restart. Không sửa snapshot nghiệp vụ có sẵn hoặc hợp đồng/ADR.
- 2.000 UUID ghế tổng hợp: `20500000-0000-4000-8000-000000000001` đến `...002000`. T-202 nhận UUID ghế sau khi kiểm tra snapshot, chưa kiểm tra seat map. Kịch bản không đại diện cho kiểm chứng seat map/giá.

## Kết quả đo thật

Mỗi VU có subject JWT RS256 riêng, chọn ngẫu nhiên một ghế, gửi đúng một POST; không retry, gia hạn hay release. Dùng `per-vu-iterations` theo [tài liệu k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/per-vu-iterations/). RPS dưới đây là tổng request thử gửi, **bao gồm kết nối lỗi**, không phải năng lực phục vụ thành công.

| Chỉ số                                |                   S1 trực tiếp |                    S1 qua Kong |          Smoke chẩn đoán |
| ------------------------------------- | -----------------------------: | -----------------------------: | -----------------------: |
| Thời điểm hoàn tất (UTC+7)            |                       16:49:38 |                       16:50:45 |                 16:51:16 |
| VU / ghế                              |                  5.000 / 2.000 |                  5.000 / 2.000 |              100 / 2.000 |
| Iteration hoàn tất / gián đoạn        |                      5.000 / 0 |                      5.000 / 0 |                  100 / 0 |
| Tổng RPS                              |                       1.043,79 |                       2.126,33 |                   389,11 |
| 201 / 409 / 5xx                       |                   597 / 82 / 0 |                   203 / 12 / 0 |               98 / 2 / 0 |
| Tỷ lệ 409 (mọi lần thử)               |                          1,64% |                          0,24% |                    2,00% |
| Tỷ lệ 5xx (mọi lần thử)               |                             0% |                             0% |                       0% |
| Lỗi kết nối / tỷ lệ                   |                 4.321 / 86,42% |                 4.785 / 95,70% |                   0 / 0% |
| 201 mỗi giây                          |                         124,63 |                          86,33 |                   381,33 |
| p50 / p95 / p99 HTTP, mọi mẫu (ms)    |        0 / 2.929,36 / 3.241,67 |               0 / 0 / 1.817,83 | 191,46 / 230,86 / 231,60 |
| p50 / p95 / p99 chỉ HTTP 201/409 (ms) | 2.901,68 / 3.261,23 / 3.282,66 | 1.731,40 / 1.915,84 / 1.963,57 | 191,46 / 230,86 / 231,60 |
| k6 exit / threshold                   |                      99 / fail |                      99 / fail |                  0 / đạt |
| Verifier exit / oversell              |                          0 / 0 |                          0 / 0 |                    0 / 0 |
| Thành công stream = ghế Redis         |                      597 = 597 |                      203 = 203 |                  98 = 98 |

Các mẫu lỗi kết nối có HTTP duration 0, nên **không dùng p50=0 để kết luận latency tốt**. Các tỷ lệ 5xx=0 không bao gồm lỗi transport và không có nghĩa là khả dụng 100%. Summary nguồn: [direct](s1-direct-summary.json), [Kong](s1-kong-summary.json), [smoke](s1-smoke-summary.json). Lượt trực tiếp chạy trước khi bổ sung metric `s1_transport_error`; `s1_unexpected` và log kết nối ghi nhận 4.321 lỗi. Threshold giữ nguyên giữa các lượt.

Lượt Kong dùng `make kong-loadtest` có sẵn (600.000 request/phút/IP) để đo đường routing, sau đó `make kong-reload` khôi phục dev. Không dùng cấu hình này trên production.

## Bằng chứng verifier

Verifier chạy offline sau khi k6 kết thúc, trước TTL; đọc toàn bộ stream theo trang 500, phát hiện mọi ghế lặp (kể cả cùng holder), SCAN key ghế ngoài đường nóng và đối chiếu tập ghế/chủ giữ/TTL. Stream rỗng, dữ liệu hết hạn, sai chủ, thiếu TTL, ghế ngoài stream, số thành công khác k6 đều làm exit 1. Không release/checkout hay traffic khác trong lúc xác minh; kiểm tra độ dài stream trước/sau chỉ phát hiện append, không bảo vệ khỏi mọi thay đổi từ tác nhân ngoài.

```json
{"event_id":"d42c2639-1325-4406-b050-3b38308c867a","entries":597,"successes":597,"held":597,"oversell":0}
{"event_id":"ca187f89-d0d8-4964-9dd6-952d6459a529","entries":203,"successes":203,"held":203,"oversell":0}
{"event_id":"b646d0a5-53e9-4959-b755-a3448557c8a0","entries":98,"successes":98,"held":98,"oversell":0}
```

`node --test scripts/test-verify-oversell.mjs scripts/test-mint-test-tokens.mjs`: **12 test pass, 0 fail** trên Redis test riêng. Ca `duplicate` tự ghi **một ghế hai lần thành công** bằng XADD, CLI thoát 1 và báo `Duplicate successful hold for seat ...`; ca hợp lệ thoát 0. Có thêm test phân trang 501 ghế. Test JWT kiểm chữ ký, claim/expiry, subject khác nhau, dùng lại khóa dev, từ chối ghi đè và từ chối ghi token ngoài secrets.

## Nút cổ chai và giới hạn

Quan sát: Windows k6 ghi `connectex: No connection could be made because the target machine actively refused it` tới cổng 3003/8000 khi burst 5.000 kết nối; booking vẫn trả health/ready=200 sau tải. Không có HTTP 5xx. Smoke 100 VU đạt. Dấu hiệu giới hạn ở đường thiết lập/nhận kết nối trong môi trường local; **backlog/socket hoặc cạnh tranh tài nguyên cùng máy là giả thuyết, chưa xác định nguyên nhân gốc**. Chưa có capture TCP, CPU profile hoặc đo xuyên suốt để quy kết PostgreSQL, Redis, JWT hay gateway là nút cổ chai. `docker stats` sau tải không phải số đo đỉnh tải.

Hai lượt full đều fail các threshold `checks` và `s1_unexpected`; không bỏ hoặc hạ ngưỡng. Chưa chạy 10.000 VU vì cần giải quyết lỗi kết nối và đo lại 5.000 trước. Cần Tuấn chạy lại từ máy khác tới môi trường staging được phép, giữ summary + verifier, chốt nguyên nhân và review G1. Smoke không thay thế S1.

## Lệnh tái lập (Bash, Node 20, pnpm 9, Docker, k6; từ repo root)

Token/khóa chỉ nằm trong thư mục `secrets/` đã gitignore; không đưa vào PR. Chọn `secrets/t205-run` mới cho mỗi lần mint. Script tự tạo cặp RSA 2048 dev, hoặc truyền `--private-key <khóa-dev-pkcs8.pem>` để dùng cặp dev hiện có. Không dùng khóa/token production.

```bash
make up && make verify
pnpm --filter @ticketing/booking build
pnpm exec tsc --strict --skipLibCheck --esModuleInterop --module commonjs \
  --target ES2022 --types node --typeRoots services/booking/node_modules/@types \
  --outDir dist/t205 scripts/mint-test-tokens.ts
node dist/t205/mint-test-tokens.js --count 5000 --out-dir secrets/t205-run

export DATABASE_URL='postgresql://booking_user:booking_dev@localhost:5432/booking_db'
export REDIS_URL='redis://localhost:6379'
pnpm --filter @ticketing/booking exec prisma migrate deploy
node scripts/seed-s1-event.mjs
# Sao chép event_id vừa in; LUÔN tạo event mới khi chạy k6 lại.
export EVENT_ID='<event_id-vừa-in>'

export NODE_ENV=development PORT=3003 LOG_LEVEL=info
export AUTH_ISSUER='https://identity.ticketing.local' AUTH_AUDIENCE=ticketing-api
unset AUTH_JWKS_URI
export AUTH_PUBLIC_KEY_PEM="$(cat secrets/t205-run/public.pem)"
export HOLDLOG_ENABLED=true HOLD_TTL_SECONDS=3600 HOLD_MAX_SEATS=6
export ADMISSION_REQUIRED=false EVENT_CONSUMER_ENABLED=true REHYDRATE_ENABLED=true
export KAFKA_BROKERS=localhost:9092
node services/booking/dist/main.js
```

Trong terminal khác, dùng cùng EVENT_ID và REDIS_URL, chờ `/health/ready` trả 200:

```bash
export EVENT_ID='<event_id-vừa-in>' USERS=5000 SEATS=2000
export BASE_URL=http://localhost:3003
export TOKENS_FILE="$(pwd)/secrets/t205-run/tokens.json"
export K6_NO_USAGE_REPORT=true
k6 run --summary-export dist/t205/s1-summary.json infra/k6/s1-seat-contention.js
# Ghi exit code của k6 ngay; dù fail vẫn chạy verifier, giữ cả hai kết quả.
SUCCESS=$(node -e "process.stdout.write(String(require('./dist/t205/s1-summary.json').metrics.s1_success.count))")
REDIS_URL=redis://localhost:6379 bash scripts/verify-oversell.sh "$EVENT_ID" "$SEATS" "$SUCCESS"

# Test verifier và mint trên Redis tạm riêng, không dùng Redis nghiệp vụ.
docker run --rm -d --name t205-verifier-redis -p 127.0.0.1:16379:6379 redis:7.4-alpine
REDIS_URL=redis://127.0.0.1:16379 node --test scripts/test-verify-oversell.mjs scripts/test-mint-test-tokens.mjs
docker stop t205-verifier-redis
```

Qua Kong: `make kong-loadtest`, đặt `BASE_URL=http://localhost:8000/api/booking`, chạy bằng event mới; cuối cùng luôn `make kong-reload`. Trên Windows dùng Git Bash và bảo đảm `node` trong PATH là Node 20; `make SHELL='C:/Program Files/Git/bin/bash.exe' ...` nếu make chọn cmd.exe. Nếu phát tải từ máy khác, BASE_URL là địa chỉ máy booking; TOKENS_FILE là file riêng trên máy phát tải, verifier vẫn chạy nơi truy cập được Redis tương ứng. Không chạy script seed local lên DB service khác.
