# T-207 — Chuẩn bị VPS và deploy thử hạ tầng

Tài liệu để **Tuấn thực hiện** trên VPS mới. Agent chỉ chuẩn bị file và kiểm chứng local; chưa thuê VPS, cài máy chủ, cấu hình DNS/Cloudflare, nhập secret hay kiểm chứng HTTPS thực tế. ADR-0008: VPS 8–16 GB RAM, khuyến nghị 16 GB; Ubuntu 24.04 LTS amd64, Docker Engine + Compose plugin. Chưa có image nghiệp vụ, endpoint `/health/infra` chỉ chứng minh gateway hoạt động.

## 1. Tạo user deploy và bảo vệ SSH

Dùng tài khoản quản trị ban đầu của nhà cung cấp:

```bash
sudo adduser deploy
sudo install -d -m 0700 -o deploy -g deploy /home/deploy/.ssh
# Cài public key của Tuấn vào /home/deploy/.ssh/authorized_keys bằng editor.
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 0600 /home/deploy/.ssh/authorized_keys
```

Mở terminal thứ hai, kiểm tra đăng nhập `ssh deploy@<vps>` bằng key thành công trước khi tắt password login/root login trong cấu hình sshd và reload SSH. Không đóng phiên quản trị hiện tại trước khi xác nhận phiên mới hoạt động. Giữ console khôi phục của nhà cung cấp.

## 2. Cài Docker và Compose

Theo [hướng dẫn Docker chính thức cho Ubuntu](https://docs.docker.com/engine/install/ubuntu/), dùng apt repository chính thức trên VPS mới. Nếu máy đã có Docker/container runtime khác, đọc phần xung đột trong tài liệu trước; không chạy gỡ package hoặc xóa dữ liệu theo thói quen.

```bash
sudo apt update
sudo apt install -y ca-certificates curl git ufw
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker deploy
```

Đăng nhập lại user deploy để nhận group mới. Theo [Docker post-install](https://docs.docker.com/engine/install/linux-postinstall/), group docker có quyền tương đương root trên host; chỉ cấp cho người vận hành tin cậy. Kiểm tra `docker version`, `docker compose version`, `docker compose up --help` có `--wait`/`--wait-timeout`. Script cần Bash và GNU coreutils `timeout` (Ubuntu có sẵn). Không dùng convenience script cho VPS prod. Các lệnh sudo trong tài liệu do tài khoản quản trị thực hiện; deploy không cần được cấp sudo riêng.

## 3. Firewall và đường vào

Giữ SSH theo IP quản trị của Tuấn, đồng thời đặt firewall của nhà cung cấp tương tự:

```bash
# Thay IP thật trước khi chạy. Nếu SSH không ở cổng 22, dùng đúng cổng hiện tại.
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from <admin-ip> to any port 22 proto tcp
sudo ufw enable
sudo ufw status verbose
```

Chọn Cloudflare Tunnel chạy trực tiếp trên host. Không cần inbound 80/443 cho tunnel, không mở 5432, 6379, 9092, 29092, 9000, 9001, 8001. Compose chỉ bind Kong `127.0.0.1:8000`; cổng này chỉ host truy cập được. Duy trì egress DNS/HTTPS và TCP/UDP 7844 cho tunnel nếu firewall outbound bị giới hạn. Docker publish port có thể [đi vòng rule UFW](https://docs.docker.com/engine/network/packet-filtering-firewalls/), vì vậy không đổi bind thành `0.0.0.0` dựa trên UFW.

## 4. Checkout và env ngoài Git

Checkout một commit đã review vào `/opt/ticketing/repo`, chủ sở hữu deploy; không deploy thư mục có thay đổi chưa commit. Tuấn clone repo bằng quyền Git của mình, không copy private key/token vào repo. File thật nằm tại `/etc/ticketing/.env.prod`:

```bash
# Tài khoản quản trị tạo thư mục, giao quyền cho deploy.
sudo install -d -m 0700 -o deploy -g deploy /etc/ticketing
sudo install -d -m 0755 -o deploy -g deploy /opt/ticketing
# Đăng nhập bằng deploy để checkout (dùng quyền Git của Tuấn nếu repo private).
git clone https://github.com/tvangx/VENTIX.git /opt/ticketing/repo
cd /opt/ticketing/repo
git checkout --detach <reviewed-commit>
install -m 0600 .env.prod.example /etc/ticketing/.env.prod
# Dùng editor trên VPS để điền mọi giá trị còn trống.
```

Không ghi secret vào shell history, không commit `.env.prod`, bản sao/backup của nó hoặc output đầy đủ của `docker compose config` (có secret). `.gitignore` bỏ qua `.env.prod` và `.env.prod.*`, vẫn cho track `.env.prod.example`. Không `source` env file; đây là dữ liệu dotenv cho Compose, không phải shell script. Compose ưu tiên biến đã export ở shell hơn env-file: chạy từ shell deploy sạch, không export credential/image của môi trường khác.

Tạo password riêng đủ mạnh cho 10 role DB, admin bootstrap, Redis và MinIO; có thể dùng password manager hoặc `openssl rand -hex 32` trên máy đích. Điền `MINIO_ROOT_USER` và `MINIO_ROOT_PASSWORD` (ít nhất 8 ký tự); không dùng credential dev. Mật khẩu chứa `$`, `#`, nháy hoặc khoảng trắng phải được quote theo [cú pháp env-file của Compose](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/#env-file-syntax); hex ngẫu nhiên giúp tránh nhầm interpolation. MinIO root chỉ dành quản trị; khi có app, tạo credential riêng theo quyền cần dùng.

Các image trong example được pin digest đã pull local ngày 2026-10-28. Digest bảo đảm đúng image đã chọn, không tự đảm bảo hết CVE; cần kiểm tra security/update theo quy trình trước prod thật. Mọi lần nâng phiên bản phải pull thành công, kiểm tra compatibility và review digest mới. Secret dùng `${VAR:?…}`: thiếu/rỗng sẽ làm Compose config và deploy dừng, không fallback password dev. Cấu hình hạ tầng được validate bởi Compose và shell; chưa thêm biến runtime của service nên không sửa Zod schema service.

## 5. Topology và dữ liệu

| Service                                                   | Hostname PostgreSQL   | Database / role                   |
| --------------------------------------------------------- | --------------------- | --------------------------------- |
| booking                                                   | postgres-booking:5432 | booking_db / booking_user         |
| payment                                                   | postgres-payment:5432 | payment_db / payment_user         |
| ticket                                                    | postgres-ticket:5432  | ticket_db / ticket_user           |
| identity, event, resale, merch, notification, finance, ai | postgres:5432         | `<service>_db` / `<service>_user` |

Ba DB nóng tách container theo architecture-v2; các DB còn lại chung server nhưng mỗi DB/role riêng, REVOKE quyền PUBLIC. User `infra_admin` chỉ bootstrap/ops, không dùng trong service. Script prod init quote identifier/password bằng psql và SQL format, không fallback secret dev; init chỉ chạy khi volume mới. Health PostgreSQL qua TCP để không coi server tạm lúc init là đã sẵn sàng.

Backend có `internal: true`; data service chỉ ở mạng này. Kong ở cả backend và edge để nhận request từ host. Redis AOF + `noeviction`, bắt buộc password. Kafka KRaft một broker, chỉ advertise `kafka:29092` nội bộ; đây là deploy thử, **không có HA**. Không có Mailpit, Adminer, Kafka UI hoặc MinIO console public. Bảy named volumes có prefix project `ticketing-prod`, tách hẳn dữ liệu dev.

`up --wait` kiểm tra PostgreSQL/Redis/Kafka/Kong bằng healthcheck. MinIO image distroless không có shell/curl; deploy chạy BusyBox wget từ Redis Alpine vào endpoint readiness nội bộ, có timeout, rồi kiểm tra HTTP `/health/infra` của Kong. Không publish MinIO hoặc cài package bổ sung vào container. Kafka topic init dùng script hiện có với `--if-not-exists`, là job một lần (`restart: no`); các daemon đều `restart: unless-stopped`.

T-207 chỉ tạo DB/role, không chạy migration ứng dụng, không seed dữ liệu thật, không tự tạo bucket/credential ứng dụng MinIO. Cần tạo bucket và quyền riêng trước khi bật các service dùng storage. Backup/restore và giám sát đầy đủ thuộc các task sau; trước khi đưa dữ liệu thật vào phải có backup và diễn tập restore.

## 6. Deploy thử — chỉ Tuấn chạy trên VPS

```bash
cd /opt/ticketing/repo
# -q xác thực mà không in secret. Không dùng config không -q với env thật.
docker compose --env-file /etc/ticketing/.env.prod -f infra/compose/docker-compose.prod.yml config -q
bash infra/deploy/deploy.sh /etc/ticketing/.env.prod 180
curl --fail --show-error http://127.0.0.1:8000/health/infra
```

[Compose up --wait](https://docs.docker.com/reference/cli/docker/compose/up/) chờ container running/healthy; script bổ sung probe MinIO và Kafka init, lỗi bất kỳ trả exit khác 0. Mỗi giai đoạn readiness/init có timeout riêng; tổng thời gian có thể dài hơn tham số 180 giây (thời gian pull phụ thuộc registry). Script không SSH, đổi DNS, tự restart vòng lặp hoặc xóa volume. Khi lỗi, xem `docker compose ... ps`/logs tại VPS; không gửi log có credential cho người khác. Không chạy deploy.sh trên máy cá nhân trừ khi chủ động muốn tạo stack prod local.

Chạy lại script an toàn với dữ liệu đang có: pull/up giữ named volumes, topic init không tạo trùng. Đổi password trong env không đổi password role trong volume Postgres cũ: phải lập kế hoạch rotation riêng; **không reset volume để đổi mật khẩu**. Rollback image phải dùng digest cũ và giữ volume, kiểm tra tương thích dữ liệu; không tự hạ major PostgreSQL hoặc xóa volume.

## 7. Cloudflare và HTTPS — Tuấn thực hiện

Theo [hướng dẫn Cloudflare Tunnel chính thức](https://developers.cloudflare.com/tunnel/get-started/), thêm domain của Tuấn vào Cloudflare, tạo tunnel quản lý từ dashboard, chọn OS/architecture VPS và làm theo lệnh cài `cloudflared` hiển thị cho host. Chạy connector như system service; giữ tunnel token/credentials ở vị trí root-only ngoài repo, không chụp hoặc gửi lệnh chứa token vào PR.

Thêm published hostname như `staging-api.<domain>` trỏ tới `http://127.0.0.1:8000`. Host connector chỉ truy cập loopback; TLS công khai kết thúc ở Cloudflare, không dùng chế độ Flexible để public trực tiếp HTTP origin. Không tạo record DNS bỏ proxy trỏ thẳng cổng dữ liệu. Kiểm tra connector healthy, chứng chỉ HTTPS hợp lệ, rồi chạy từ máy khác:

```bash
curl --fail --show-error https://staging-api.<domain>/health/infra
curl -i https://staging-api.<domain>/api/event/v1/internal/events/x/seat-classes
```

Kỳ vọng health trả 200 JSON `scope=infrastructure-only`, route internal trả 404, có `X-Request-Id`. Các API nghiệp vụ khác hiện trả 404 vì chưa bật image/route. `/health/infra` không chứng minh checkout, DB migration hay luồng thanh toán hoạt động. Ghi kết quả thật và commit/digest deploy vào báo cáo vận hành sau khi Tuấn chạy.

## 8. Bật service nghiệp vụ sau này

Khối booking trong compose chỉ là comment, chưa được Compose parse/pull/run. Khi có image đã build/scan/pull, thêm cấu hình riêng `booking.env.prod` ngoài Git: DATABASE_URL dùng booking_user tại postgres-booking, REDIS_URL chứa password được URL-encode, Kafka bootstrap `kafka:29092`, JWT/JWKS và biến service theo schema validate. Nếu service gọi API bên ngoài, cấp network edge để egress; vẫn không publish cổng ra host.

Sau migration của từng service, thêm Kong upstream `http://booking:3003` và các service tương ứng. Giữ route chặn `/internal` (ADR-0010); gateway không thay việc verify JWT trong service. CORS/rate limit theo domain và task Kong T-206, không copy allowlist localhost của dev sang prod. Không đổi hợp đồng ADR-0009/0010 trong T-207.

## 9. Kiểm chứng local cho file và script

```bash
node infra/deploy/check-config.cjs
node --test infra/deploy/deploy.test.cjs
node infra/postgres/prod-init.test.cjs
bash -n infra/deploy/deploy.sh
bash -n infra/postgres/prod-init/01-create-databases.sh
pnpm format:check
```

Config checker dùng env giả trong thư mục tạm, kiểm tra default config và profile bootstrap, không tạo stack. Deploy test giới hạn PATH vào Docker giả và công cụ shell để không gọi nhầm Docker thật. Postgres init test chạy đúng một container Postgres tạm local, không publish port, tự dừng/xóa container sau test; không truy cập DB dev/prod đang có. Kết quả thật được ghi trong [run report T-207](../agent/runs/T-207.md).
