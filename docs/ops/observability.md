# T-501 — Observability: logs, traces, exporters và dashboards

Agent chỉ chuẩn bị và kiểm chứng local. Tuấn chuyển artifact, tạo secret và thực hiện trên EC2 Ubuntu 24.04 amd64 (2 vCPU/8 GiB/40 GiB). Không có thao tác SSH/deploy/Cloudflare trong task. Không đổi project `ticketing-prod`, credential/volume ứng dụng, subnet/IP trust Tunnel → Kong. Không cần Git hoặc Node trên EC2.

## Phiên bản ứng dụng và tên metric

T-401 #112 đã có trong main dùng xây bản T-404, nhưng EC2 được nghiệm thu ở `/opt/ticketing/demo-20261126-f7cbbc8`; chưa xác nhận đã nâng T-401. **Bật obs không cập nhật ứng dụng.** Không dùng artifact ứng dụng cũ để bật metrics.

Sáu service được duyệt (Identity/Event/Booking/Payment/Ticket/template) đổi histogram từ `http_request_duration_seconds{method,route,status}` thành `http_server_request_duration_seconds{service,method,route,status_class}`. Không phát song song. Metric nghiệp vụ và endpoint `/metrics` giữ nguyên. Middleware global ghi response hoàn tất đúng một lần, bao phủ guard/filter/404; chỉ dùng route đã đăng ký, URL không khớp dùng `unmatched`. `/metrics` không được tính; SSE chỉ có duration khi kết thúc.

Dashboard mới chỉ đọc tên mới. Kiểm tra query/dashboard ngoài repo nếu có đang dùng tên cũ. Finance/Resale/Merch/Notification chưa chuyển instrumentation trong T-404 và không nằm trong target mặc định; các assertion cũ của chúng được giữ nguyên. Khi triển khai thêm service, cần chuyển instrumentation tương ứng và thêm `{targets:["service:port"],labels:{service:"service"}}` vào `infra/prometheus/targets/apps.json`, rồi chạy promtool/check và kiểm chứng `up=1`/histogram. Không thêm target giả để coi service chưa chạy là đã giám sát.

Muốn tracing/Outbox mới trên EC2, Tuấn cần rebuild/redeploy **năm image backend demo** `ticketing-demo/{identity,event,booking,payment,ticket}:<release-mới>` từ source T-501; Web được đóng cùng demo artifact hiện có. Resale/Finance có migration `trace_context` additive nhưng chưa là daemon trong demo compose, nên không có image demo để rollout trong lượt này. Template không phải daemon EC2. Artifact obs chứa tám image observability, config/runbook và overlay `docker-compose.apps-observability.yml`; không có `demo.sh`, `deploy.sh`, env ứng dụng hoặc image ứng dụng.

## Runtime wiring của năm app demo

`docker-compose.apps.yml` là base độc lập: không mount host log, không có biến OTLP/file log và không chờ Alloy. Khi chưa chạy observability (kể cả T-208 demo), chỉ dùng base này.

Chỉ khi rollout observability, dùng thêm `infra/compose/docker-compose.apps-observability.yml`. Overlay truyền trực tiếp `OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy:4318` và `LOG_FILE_PATH=/var/log/ticketing/<service>.log` cho Identity, Event, Booking, Payment, Ticket. Nó mount cùng `APP_LOG_DIR`, vẫn giữ stdout/Docker `local` driver, và chỉ chờ `app-log-init` tạo thư mục; **không** có `depends_on` đến Alloy. Vì telemetry trong app là optional, Alloy chưa chạy hoặc restart không chặn health/request/worker.

`app-log-init` dùng image Identity đã có trong demo release, chạy một lần với capability ownership tối thiểu để tạo `APP_LOG_DIR` owner `1000:473`, mode `2775` (setgid). Năm app chạy UID 1000 ghi được file; file mới kế thừa group 473 để Alloy UID/GID 473 đọc qua bind mount read-only. Không dùng Docker socket, privileged mode, public port hay secret mới.

## Truy cập và tài nguyên

- Prometheus: host **127.0.0.1:9090**, Grafana: **127.0.0.1:3030**, Loki: **127.0.0.1:3100**, Jaeger: **127.0.0.1:16686**, Alloy OTLP/HTTP: **127.0.0.1:4318**. Không public route/hostname hoặc đổi trust Kong/Cloudflare. Không mount docker.sock. Prometheus, Alloy và exporters nối backend có sẵn `ticketing-prod_backend`; Grafana, Loki và Jaeger chỉ nối bridge obs-access. Không tạo lại hoặc đổi mạng ứng dụng; backend prod vẫn internal.
- Grafana tắt anonymous/sign-up, dùng admin riêng. Không đưa secret vào repo/chat/history. File env bên ngoài artifact, quyền 0600. Không in `docker compose config` đầy đủ với env thật.
- Tổng trần container observability là **2.47 GiB RAM và 2.75 CPU**: Prometheus 512 MiB/0.5, Grafana 512 MiB/0.5, Loki 384 MiB/0.4, Jaeger 512 MiB/0.5, Alloy 256 MiB/0.3, Kafka exporter 128 MiB/0.2, Redis exporter 96 MiB/0.15, PostgreSQL exporter 128 MiB/0.2. Đây là giới hạn bảo vệ, không phải footprint; phải kiểm tra `free -h`, `df -h`, `docker stats` trên EC2 8 GiB trước start.
- Scrape 15s/timeout 5s; 20.000 samples/target/scrape để chặn bùng nổ nhãn. Prometheus retention **7 ngày hoặc 1 GiB** (ngưỡng đạt trước); Loki retention 7 ngày; Jaeger Badger TTL 7 ngày. WAL/head/compaction và Badger có thể tạm vượt dữ liệu hữu dụng, nên không coi đây là disk quota. Dành headroom cho WAL, Grafana SQLite, image/archive; theo dõi `df -h`, `docker stats`, `du` định kỳ. Không tăng EC2/dùng dịch vụ trả phí.
- Dashboard chọn service và thời gian, mặc định 15 phút; rate window dùng `$__rate_interval`. Health probes bị loại khỏi RED; 404 vẫn tính. Scrape availability không đồng nghĩa app healthy. Panel metric presence giúp phát hiện backend cũ. Không traffic thì ratio/quantile là No data, không tô khỏe giả. Histogram cần tối thiểu hai scrape; low traffic có thể làm quantile thiếu/ước lượng thô.

## Đóng gói trên Windows

Sau khi commit source, Docker Desktop Linux chạy được, đủ chỗ trên ổ chứa Docker và ổ D:

```powershell
powershell -NoProfile -File infra/obs/package-obs.ps1 -Release obs-YYYYMMDD-<commit>
```

Script pull tám image amd64 ghim digest trong `infra/obs/obs.env.example`, save `obs-images.tar`, copy allowlist runtime (gồm app observability overlay), ghi `OBS_IMAGES`, `OBS_SOURCE_COMMIT`, `OBS_SHA256SUMS`, archive và checksum tại `dist/obs/`. Không ship `.git`, env thật, source nghiệp vụ. Image manifest ghi tag, image ID, platform và digest gốc; docker save/load có thể không giữ RepoDigests nên runtime chỉ dùng tag sau khi đối chiếu đúng ID trong manifest đã checksum. Giữ gói cũ để rollback obs.

Local Git Bash (không dùng bash WSL chưa có Docker integration): copy env mẫu thành file bị ignore, tạo password giả chỉ dùng local; đặt `OBS_NETWORK` đúng mạng app local. Trong PowerShell có thể gọi Git Bash:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' infra/obs/obs.sh check /d/VENTIX/dist/obs/local.env ticketing-t404-local
& 'C:\Program Files\Git\bin\bash.exe' infra/obs/obs.sh start /d/VENTIX/dist/obs/local.env ticketing-t404-local
& 'C:\Program Files\Git\bin\bash.exe' infra/obs/obs.sh stop /d/VENTIX/dist/obs/local.env ticketing-t404-local
```

Git Bash/Linux có make: `make obs-check`, `make obs-up`, `make obs-down` với `OBS_ENV=/absolute/path` và `OBS_PROJECT=ticketing-prod` (mặc định). Wrapper dùng Compose standalone obs; kiểm thử merge với base+tunnel+apps không thay config ứng dụng. Dev chạy app trên host có thể đổi target sang `host.docker.internal:<port>` (Linux cần tự cấu hình host-gateway); không áp file target dev lên EC2.

## Tuấn thực hiện trên EC2

1. Xác nhận release ứng dụng đang chạy và metric mới. Kiểm tra headroom RAM/disk bằng `free -h`, `df -h`, `docker system df`. Chuyển archive và checksum qua SSH hiện có, giữ artifact obs riêng với artifact app. Không giải nén đè lên release app.
   Cấu hình Kong T-208 có route prefix rộng: T-404 bổ sung `block-metrics` trong các file `infra/kong/kong*.yml`. Tuấn phải áp cấu hình gateway đã review từ release ứng dụng hiện tại (quy trình T-208) trước nghiệm thu, rồi kiểm GET/OPTIONS `/api/{identity,event,booking,payment,ticket}/metrics` trả 404. Obs artifact không tự thay Kong hoặc mang theo bản cũ của cấu hình gateway. Không suy từ `up=1` rằng endpoint đã được chặn ngoài mạng.
2. Tại `/opt/ticketing`, kiểm checksum, liệt kê archive (chỉ thư mục release, không đường tuyệt đối/`..`) rồi giải nén:

```bash
sha256sum --check obs-RELEASE.tar.sha256
tar -tf obs-RELEASE.tar
tar -xf obs-RELEASE.tar
cd /opt/ticketing/obs-RELEASE
sha256sum --check OBS_SHA256SUMS
```

3. Chạy migration `trace_context` của identity, event, booking, payment, ticket, resale, finance **trước** khi rollout image ứng dụng mới. Cột nullable/additive; rollback ứng dụng giữ nguyên cột và dữ liệu, không backfill parent giả. Không ghi đè `.env.prod`, `.env.demo`, token Tunnel hoặc bất kỳ volume nào.
4. Tạo role monitoring một lần bằng `infra/postgres/monitoring-role.sql` với password nhập qua editor/prompt bảo mật. Exporter chỉ dùng `ticketing_monitor`, không dùng `infra_admin`; role không có `USAGE`/`SELECT` schema nghiệp vụ. Tạo `/etc/ticketing/.env.obs` từ mẫu, `chmod 600`, thêm `POSTGRES_EXPORTER_DSN` với credential role này. Giữ các image digest/network/port, chọn admin riêng. Không dán password vào shell command. Định dạng env riêng **KEY=value không quote/khoảng trắng/interpolation**; password 24–128 ký tự chữ/số/`_`/`-`.
5. Sau khi load/check artifact demo mới theo runbook T-208, dùng cùng `APP_LOG_DIR` trong `/etc/ticketing/.env.obs` để chạy overlay ứng dụng. Thay `RELEASE_DIR` bằng thư mục demo đã giải nén; không chạy lệnh này cho demo không observability:

```bash
app_obs=(docker compose -p ticketing-prod \
  --env-file /etc/ticketing/.env.prod --env-file /etc/ticketing/.env.demo \
  --env-file /etc/ticketing/.env.obs --env-file "$RELEASE_DIR/release.env" \
  -f "$RELEASE_DIR/infra/compose/docker-compose.prod.yml" \
  -f "$RELEASE_DIR/infra/compose/docker-compose.tunnel.yml" \
  -f "$RELEASE_DIR/infra/compose/docker-compose.apps.yml" \
  -f "$RELEASE_DIR/infra/compose/docker-compose.apps-observability.yml")
"${app_obs[@]}" config --quiet
"${app_obs[@]}" run -T --rm --no-deps app-log-init
"${app_obs[@]}" up -d --no-deps --pull never --wait --wait-timeout 240 identity event booking payment ticket
stat -c '%u:%g %a %n' "$APP_LOG_DIR"
```

Expected directory is `1000:473 2775`; `docker inspect` must show app bind mounts read-write and Alloy's `/var/log/ticketing` bind read-only. This starts correctly before Alloy and keeps Docker stdout logging. Do not add this overlay to base/T-208-only deployment.

6. Chạy check rồi start observability (không cần env prod/demo hoặc token Cloudflare):

```bash
bash infra/obs/obs.sh check /etc/ticketing/.env.obs
bash infra/obs/obs.sh start /etc/ticketing/.env.obs
```

`check` kiểm checksum/load image/ID/amd64/network/promtool, không start/recreate ứng dụng. `start` chỉ force-recreate observability daemons và chờ readiness. Không migration, không restart ứng dụng, không prune/remove-orphans/down. Alloy chạy UID 473, app log directory được mount read-only, không có docker.sock; init job chỉ chown checkpoint volume với capability tối thiểu. Jaeger chạy UID 10001 với Badger trên volume; init job chỉ chown thư mục Badger. Nếu check/start thất bại, xem log obs và dừng; app giữ nguyên.

7. Tạo traffic smoke nhẹ vào ứng dụng; kiểm tra `http://127.0.0.1:9090/api/v1/targets` từ server và query `up{job="application"}` đủ năm service bằng 1. Kiểm tra counter tăng sau ít nhất hai lần scrape, datasource Grafana khỏe, dashboard có rate/ratio/p50/p95/p99; Loki có JSON log và Jaeger có trace của từng service. Restart Alloy, gọi một request trong khi Alloy chưa sẵn sàng rồi kiểm health/worker; sau Alloy trở lại kiểm log/trace mới được thu. Backend cũ có thể `up=1` nhưng metric mới absent: chưa nghiệm thu RED; không tự nâng app.

## SSH tunnel từ Windows

PowerShell, dùng địa chỉ/user/key SSH hiện tại của Tuấn:

```powershell
ssh -N -L 3030:127.0.0.1:3030 -L 9090:127.0.0.1:9090 ubuntu@<EC2-host>
```

Mở `http://localhost:3030`, đăng nhập admin rồi chọn **VENTIX → VENTIX — HTTP RED**. Prometheus chỉ truy cập local qua tunnel ở `http://localhost:9090`. Nếu port Windows bị chiếm, đổi vế trái (ví dụ `13030:127.0.0.1:3030`). Không mở security group hay Cloudflare hostname cho obs.

## Stop, nâng cấp và rollback

```bash
bash infra/obs/obs.sh stop /etc/ticketing/.env.obs
```

Chỉ dừng các daemon observability (Prometheus, Grafana, Loki, Jaeger, Alloy và exporters), giữ toàn bộ volume của chúng, ứng dụng, Tunnel, Kafka và dữ liệu. Không `down -v`, `volume rm`, `system prune` hoặc `--remove-orphans`.

Nâng cấp: giải nén artifact obs mới riêng, giữ project/network/credential/volume, dùng env obs khớp digest artifact, chạy check/start từ thư mục mới. Cấu hình dashboard được provision lại; không sửa UI để lưu lâu dài. Password admin env dùng lúc khởi tạo Grafana DB; đổi env không tự đổi password đã lưu. Quản lý thay đổi mật khẩu qua Grafana sau đăng nhập.

Rollback cấu hình cùng phiên bản image: từ artifact obs trước, chạy `check`, rồi `rollback` với env khớp artifact đó; wrapper giữ volumes. Nếu đã nâng phiên bản Grafana/Prometheus, chỉ downgrade khi chính thức hỗ trợ tương thích DB/TSDB; nếu chưa xác nhận, dùng `stop` để tháo obs khỏi hoạt động, giữ dữ liệu và app, không tự xóa DB để ép downgrade. Task T-404 chưa diễn tập downgrade qua phiên bản khác.

## Kiểm chứng local có thể lặp lại

```powershell
node infra/obs/config.test.cjs
pnpm build
node infra/obs/smoke.cjs
```

Smoke dùng bootstrap thật năm backend trên host, PostgreSQL Testcontainers riêng từng service (workers tắt), một TCP relay Docker chỉ chuyển byte để tên container/port trong target mặc định trỏ tới host. Không giả metric/API response, không dùng credential/data demo. Kiểm datasource/dashboard query qua Grafana, counter tăng, `up=1`, recreate giữ TSDB/Grafana preferences, stop giữ app; Kong test cô lập chặn 25 probe metrics GET/OPTIONS. Đặt `K6_BINARY` trỏ tới k6 chính thức nếu có để chạy smoke 1 VU/15s và bắt buộc có checks thật; không dùng lượt chạy 0 checks để nghiệm thu. Không chạy build/generate Prisma cùng smoke trên Windows; harness dùng bản sao DLL engine riêng để tránh khóa DLL của client khi quan sát.

Đây là kiểm chứng local đường HTTP/observability, không nghiệm thu saga/sandbox/EC2. Script giữ volume obs test, không prune; bằng chứng footprint/disk tại `dist/obs/smoke/result.json`. Số đo và tình trạng ảnh dashboard được tóm tắt trong run report T-404.
