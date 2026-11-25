# T-207 — Chuẩn bị VPS và deploy thử hạ tầng

Tài liệu để **Tuấn thực hiện** trên VPS mới. Agent chỉ chuẩn bị file và kiểm chứng local; chưa thuê VPS, cài máy chủ, cấu hình DNS/Cloudflare, nhập secret hay kiểm chứng HTTPS thực tế. ADR-0008: VPS 8–16 GB RAM, khuyến nghị 16 GB; Ubuntu 24.04 LTS amd64, Docker Engine + Compose plugin. Chưa có image nghiệp vụ, endpoint `/health/infra` chỉ chứng minh gateway hoạt động.

Ngày 2026-11-25 Tuấn báo đã nghiệm thu base từ `11496bf` trên EC2 Sydney: Ubuntu 24.04 amd64, m7i-flex.large, 8 GiB RAM, gp3 40 GiB, Docker 29.10.1, Compose v5.8.0. Repo `/opt/ticketing/repo`, env `/etc/ticketing/.env.prod`; deploy thuộc group docker và không có sudo. 8 daemon, DB owner/CONNECT, Redis, 14 topic và `/health/infra` đã được Tuấn kiểm tra. Đây là thông tin bàn giao, agent không SSH xác minh. Máy đã có hạ tầng thì bỏ qua phần cài máy/clone/tạo env mới, giữ nguyên env, volume và password; chỉ checkout commit bổ sung đã review rồi chạy phần 6. Chưa có domain/token thì dùng base; phần 7 là tùy chọn, HTTPS/tunnel thật **chưa kiểm chứng**.

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

Cloudflare Tunnel chạy bằng container qua overlay ở phần 7. Không cần inbound 80/443 cho tunnel, không mở 5432, 6379, 9092, 29092, 9000, 9001, 8001. Compose chỉ bind Kong `127.0.0.1:8000`; cổng này chỉ host truy cập được. Duy trì egress DNS/HTTPS và TCP/UDP 7844 cho tunnel nếu firewall outbound bị giới hạn. Docker publish port có thể [đi vòng rule UFW](https://docs.docker.com/engine/network/packet-filtering-firewalls/), vì vậy không đổi bind thành `0.0.0.0` dựa trên UFW.

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

Năm image base trong example được pin digest đã pull local ngày 2026-10-28. Image cloudflared bổ sung được pull ngày 2026-11-25; chỉ cần khi bật tunnel. Trên máy đã có env, thêm đúng dòng `CLOUDFLARED_IMAGE` từ example, không copy đè env hoặc tạo lại mật khẩu. Digest bảo đảm đúng image đã chọn, không tự đảm bảo hết CVE; cần kiểm tra security/update theo quy trình trước prod thật. Mọi lần nâng phiên bản phải pull thành công, kiểm tra compatibility và review digest mới. Secret dùng `${VAR:?…}`: thiếu/rỗng sẽ làm Compose config và deploy dừng, không fallback password dev. Cấu hình hạ tầng được validate bởi Compose và shell; chưa thêm biến runtime của service nên không sửa Zod schema service.

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

Script đóng stdin bằng `/dev/null`; readiness và Kafka init đều dùng `-T --interactive=false`. GNU timeout có `--kill-after=2`: nếu client không dừng sau TERM thì gửi KILL sau tối đa 2 giây nữa. Một probe không được vượt thời gian còn lại của giai đoạn quá khoảng kill-after/lịch CPU; timeout không phải cam kết thời gian thực. Không bỏ probe MinIO/Kong khi endpoint từng trả 200 riêng lẻ. Timeout Kafka trả lỗi và dừng deploy; client bị kill không bảo đảm job bên daemon đã dừng, kiểm tra `docker compose ... ps -a` trước khi chạy lại.

Chạy lại script an toàn với dữ liệu đang có: pull/up giữ named volumes, topic init không tạo trùng. Đổi password trong env không đổi password role trong volume Postgres cũ: phải lập kế hoạch rotation riêng; **không reset volume để đổi mật khẩu**. Rollback image phải dùng digest cũ và giữ volume, kiểm tra tương thích dữ liệu; không tự hạ major PostgreSQL hoặc xóa volume.

## 7. Cloudflare và HTTPS — Tuấn thực hiện

Theo [hướng dẫn Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/get-started/), Tuấn thêm domain và tạo remotely managed tunnel trên dashboard. Lấy token vào editor an toàn, không chạy lệnh cài host chứa token. `infra/compose/docker-compose.tunnel.yml` thêm container chính thức `cloudflare/cloudflared:2026.11.0` pin digest trong example, tự restart, log local 10 MiB × 3, không publish port. Base G4 không cần image/token tunnel để validate hoặc deploy.

Connector dùng mạng egress riêng và mạng origin internal `172.30.207.0/29`, chỉ chia sẻ với Kong; không tham gia backend dữ liệu. IP connector `172.30.207.2`, Kong `.3`; Kong chỉ trust `172.30.207.2/32`, đọc `CF-Connecting-IP` và không recursive. Không trust toàn Docker subnet, loopback host hoặc IP edge Cloudflare: TCP peer tại Kong là connector. Trước khi bật, Tuấn kiểm tra `docker network ls`/`docker network inspect` và route EC2/VPC/VPN để subnet không trùng. Nếu trùng, dừng và sửa đồng bộ subnet/hai IP/trust/test trong PR được review; không tự nới trust. Connector có quyền Docker khác không thuộc ranh giới chống giả mạo này.

Tạo file token ngoài Git bằng user deploy (lần đầu; không ghi đè file đã có):

```bash
test ! -e /etc/ticketing/cloudflared-token && install -m 0600 /dev/null /etc/ticketing/cloudflared-token
# Dùng editor trên EC2 để dán chỉ giá trị token vào file; không dùng echo TOKEN hay export TOKEN.
```

Image đã inspect là UID/GID `65532:65532`. Sau khi nhập token, **tài khoản quản trị có sudo**, không phải deploy, đặt group đọc cho container:

```bash
sudo chown deploy:65532 /etc/ticketing/cloudflared-token
sudo chmod 0440 /etc/ticketing/cloudflared-token
stat -c '%U %g %a' /etc/ticketing/cloudflared-token
```

Kỳ vọng owner deploy, group 65532, mode 440; thư mục `/etc/ticketing` vẫn 0700 deploy. Docker daemon bind file trực tiếp vào `/run/secrets/cloudflared-token`, read-only; container không cần quyền traverse thư mục host. Nếu thay file bằng editor/rotation sau này, quản trị kiểm tra lại owner/group/mode rồi recreate connector. Không cấp sudo cho deploy chỉ để làm bước này, không dùng mode 644 hoặc chạy cloudflared bằng root. Khi chưa có quản trị áp quyền phù hợp thì giữ base chạy, chưa bật tunnel. File chỉ chứa token; nội dung không đi qua argv, env hoặc log. Không dùng `TUNNEL_TOKEN`, không bật log debug hoặc sao chép token vào repo/PR.

Thêm published hostname `staging-api.<domain>` với origin **`http://kong:8000`** trên dashboard. TLS công khai kết thúc ở Cloudflare; không tạo DNS bỏ proxy tới data port. Kiểm tra Managed Transform không xóa IP khách; Pseudo IPv4 không ghi đè địa chỉ thật nếu cần IPv6. [CF-Connecting-IP](https://developers.cloudflare.com/fundamentals/reference/http-headers/) có ngoại lệ với Worker cùng zone: chỉ dùng Worker tin cậy hoặc không route Worker trước hostname này. Không tin header do request trực tiếp từ host/backend gửi vào Kong.

Deploy có tunnel (user deploy; env chỉ nhận **đường dẫn file**, không nhận nội dung token):

```bash
cd /opt/ticketing/repo
export CLOUDFLARED_TOKEN_FILE=/etc/ticketing/cloudflared-token
prod=(docker compose --project-name ticketing-prod --env-file /etc/ticketing/.env.prod -f infra/compose/docker-compose.prod.yml)
tunnel=("${prod[@]}" -f infra/compose/docker-compose.tunnel.yml)
"${tunnel[@]}" config -q
bash infra/deploy/deploy.sh /etc/ticketing/.env.prod 180 --tunnel /etc/ticketing/cloudflared-token
"${tunnel[@]}" ps
"${tunnel[@]}" exec -T --interactive=false cloudflared cloudflared tunnel --metrics 127.0.0.1:2000 ready </dev/null
```

`--token-file` được [Cloudflare hỗ trợ](https://developers.cloudflare.com/tunnel/reference/run-parameters/) và mount bắt buộc file có sẵn, không tự tạo thư mục nếu gõ sai. Script kiểm tra đường dẫn tuyệt đối, file đọc được/không rỗng và mọi image pin digest trước pull/up. Healthcheck connector gọi `/ready` nội bộ qua CLI thật, chỉ healthy khi đã có kết nối Cloudflare; metrics chỉ bind loopback container. `up --wait` sẽ lỗi khi connector chưa healthy, không in thông báo deploy thành công. Daemon vẫn có thể tiếp tục reconnect theo restart policy; lệnh thất bại không tự stop stack.

Nếu trước đây đã cài connector host, Tuấn dùng tài khoản quản trị dừng service host theo cấu hình thực tế khi chuyển sang container; không chạy song song host và container trên cùng tunnel vì traffic có thể đi vào hai origin khác nhau. Không cần cài host connector cho phương án này.

Kiểm tra từ máy khác sau khi dashboard báo connector healthy và certificate hợp lệ:

```bash
curl --fail --show-error https://staging-api.<domain>/health/infra
curl -i https://staging-api.<domain>/api/event/v1/internal/events/x/seat-classes
# Client cố giả header vẫn phải được Cloudflare thay bằng IP kết nối thật.
curl --fail --show-error -H 'CF-Connecting-IP: 198.51.100.99' https://staging-api.<domain>/health/infra
```

Kỳ vọng health trả 200 JSON `scope=infrastructure-only`, route internal trả 404, có `X-Request-Id`. Các API nghiệp vụ khác hiện trả 404 vì chưa bật image/route. `/health/infra` không chứng minh checkout, DB migration hay luồng thanh toán hoạt động. Ghi kết quả thật và commit/digest deploy vào báo cáo vận hành sau khi Tuấn chạy.

Đối chiếu IP trong access log Kong tại EC2 với public IP máy thử; thử cả IPv4/IPv6 nếu có. Request trực tiếp `curl -H 'CF-Connecting-IP: 198.51.100.99' http://127.0.0.1:8000/health/infra` không được làm địa chỉ khách trong log thành IP giả. Giới hạn log chỉ xem tại EC2, không gửi IP thật/token cho agent. Agent đã test trust/header/internal bằng HTTP local, còn connector thật, DNS và HTTPS EC2 **chưa kiểm chứng**.

### Dừng và rollback giữ dữ liệu

Các lệnh dưới dùng hai mảng Compose phần trên, không thay project name. Dừng tunnel riêng: `"${tunnel[@]}" stop cloudflared`. Dừng toàn bộ daemon giữ container/network/volume: `"${tunnel[@]}" stop`; khởi động lại bằng lệnh deploy có tunnel. Không dùng `down -v`, `volume rm`, reset hoặc prune volume.

Muốn bỏ overlay: stop cloudflared trước, chạy `bash infra/deploy/deploy.sh /etc/ticketing/.env.prod 180` để Kong trở lại base không trust connector. Connector đã stop có thể hiện như orphan; không dùng `--remove-orphans` tùy tiện. Base không tự stop tunnel đang chạy, vì vậy không bỏ qua bước stop khi rollback. Re-enable bằng cùng lệnh deploy có tunnel.

Rollback phiên bản cloudflared: stop connector, giữ file token và mọi volume; sửa duy nhất `CLOUDFLARED_IMAGE` sang digest cũ đã review/pull rồi chạy deploy có tunnel. Rollback về base commit `11496bf` thì stop connector bằng overlay **trước checkout**, giữ env/image/password và bảy volume; deploy.sh bản cũ phải chạy với stdin `/dev/null` cho tới khi nâng lại bản sửa. Kiểm tra `/health/infra`, 8 daemon, quyền DB, Redis và 14 topic như lần nghiệm thu; không downgrade PostgreSQL major. Token rotation là thao tác riêng của Tuấn khi cần, không tự xoay trong rollback.

## 8. Bật service nghiệp vụ sau này

Khối booking trong compose chỉ là comment, chưa được Compose parse/pull/run. Khi có image đã build/scan/pull, thêm cấu hình riêng `booking.env.prod` ngoài Git: DATABASE_URL dùng booking_user tại postgres-booking, REDIS_URL chứa password được URL-encode, Kafka bootstrap `kafka:29092`, JWT/JWKS và biến service theo schema validate. Nếu service gọi API bên ngoài, cấp network edge để egress; vẫn không publish cổng ra host.

Sau migration của từng service, thêm Kong upstream `http://booking:3003` và các service tương ứng. Giữ route chặn `/internal` (ADR-0010); gateway không thay việc verify JWT trong service. CORS/rate limit theo domain và task Kong T-206, không copy allowlist localhost của dev sang prod. Không đổi hợp đồng ADR-0009/0010 trong T-207.

## 9. Kiểm chứng local cho file và script

```bash
node infra/deploy/check-config.cjs
node --test infra/deploy/deploy.test.cjs
node --test infra/deploy/tunnel.int.test.cjs
node infra/postgres/prod-init.test.cjs
bash -n infra/deploy/deploy.sh
bash -n infra/postgres/prod-init/01-create-databases.sh
pnpm format:check
```

Config checker dùng env giả trong thư mục tạm, kiểm tra base/bootstrap và overlay tunnel, không tạo stack. Deploy test giới hạn PATH vào Docker giả và công cụ shell để không gọi nhầm Docker thật. Tunnel integration test tạo Kong/client/network/volume token tạm, không publish port, không dùng token thật hoặc kết nối Cloudflare; kiểm tra HTTP trust/internal, quyền Linux của token và Linux PTY/timeout. Test dùng subnet origin mẫu nên cần chạy khi chưa có stack tunnel chiếm subnet này. Postgres init test chạy đúng một container Postgres tạm local, không publish port, tự dừng/xóa container sau test; không truy cập DB dev/prod đang có. Kết quả thật được ghi trong [run report T-207](../agent/runs/T-207.md).
