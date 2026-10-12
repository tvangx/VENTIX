# Phase 0 — Hướng dẫn setup để cả team bắt đầu code

**Người thực hiện:** Tuấn · **Thời gian dự kiến:** 1–1,5 ngày cho phần nền, rồi nối tiếp T-102/T-103 của tuần 1
**Đi kèm:** `ticketing-platform-phase0.zip` (repo khởi động đã dựng sẵn)

---

## 1. Phase 0 gồm gì và "xong" nghĩa là gì

Phase 0 = **Ngày 0** (tài khoản, máy, repo) + **T-101** (monorepo) + **T-104** (hạ tầng Docker) + **T-105** (CI) + bản nháp của **T-107** (event contract, ADR). Sau phase 0, Sơn và Vũ clone repo về là chạy được hạ tầng và bắt đầu code.

**Xong khi:**

- [ ] Repo GitHub có `main` được bảo vệ, CI chạy xanh.
- [ ] Cả 3 người chạy `make up` rồi `make verify` ra **TẤT CẢ OK** trên máy mình.
- [ ] 90 task đã thành Issue, gán đúng người, đúng nhãn tuần/ưu tiên.
- [ ] Đã có tài khoản VNPay sandbox (hoặc đã nộp đăng ký), thử xong `cloudflared`.
- [ ] Sơn và Vũ đã nhận hướng dẫn onboarding (mục 6) và biết việc đầu tiên của mình.

---

## 2. Trong zip có gì, và mức độ đã kiểm chứng

| Thành phần                 | Nội dung                                                                     | Đã kiểm chứng?                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Monorepo                   | pnpm workspace + Turborepo, ESLint, Prettier, commitlint, husky, lint-staged | **Đã chạy thật:** `pnpm install/build/lint/typecheck/test` đều qua; hook chặn commit sai chuẩn |
| `packages/event-contracts` | Envelope, 7 topic, 22 loại sự kiện (zod), registry, 4 test                   | **Đã chạy thật:** build + typecheck + lint + test qua                                          |
| `infra/compose`            | Postgres, Redis, Kafka KRaft, MinIO, Mailpit, Kong, Kafka UI, Adminer        | **Mới kiểm tra cú pháp YAML.** Chưa chạy được vì môi trường của mình không có Docker           |
| `infra/postgres/init`      | Tạo 10 DB + 10 user riêng, chặn truy cập chéo                                | **Mới kiểm tra cú pháp bash.** Chưa chạy với Postgres thật                                     |
| `infra/kafka`              | Script tạo topic + DLQ                                                       | Mới kiểm tra cú pháp                                                                           |
| `infra/kong/kong.yml`      | Route 9 service, CORS, rate limit, request-id                                | Mới kiểm tra cú pháp YAML                                                                      |
| `scripts/`                 | check-prereqs, verify-infra, gh-bootstrap, create-issues, gen-issues         | `gen-issues` và `create-issues` (dry-run) đã chạy; phần gọi `gh`/`docker` chưa chạy thật       |
| `.github/`                 | CI (build + Trivy), CODEOWNERS, PR/Issue template, Dependabot                | Chưa chạy trên GitHub                                                                          |
| `docs/adr`                 | 8 ADR nháp (0001–0008)                                                       | —                                                                                              |

**Hệ quả thực tế:** các phần Docker/GitHub rất có thể gặp 1–2 lỗi nhỏ ở lần chạy đầu (tên tag image, cổng bị chiếm, quyền…). Bạn chạy `make up` và dán lỗi cho mình, mình sẽ sửa ngay. Mục 5 liệt kê sẵn các lỗi dễ gặp nhất.

---

## 3. Bước 1 — Chuẩn bị máy và tài khoản (Ngày 0)

### 3.1 Máy của bạn

```bash
# Linux/macOS/WSL2
node -v          # cần >= 20
corepack enable && corepack prepare pnpm@9.15.9 --activate
docker --version && docker compose version
```

Cài thêm khi cần: `gh` (GitHub CLI, dùng cho script tạo issue), `k6` (tuần 2), `cloudflared` (nhận IPN VNPay).
Windows: **dùng WSL2** và để repo trong ổ Linux của WSL (`~/work/...`), không đặt trong `/mnt/c` (chậm và lỗi quyền file).

### 3.2 Tài khoản (làm song song, vì có việc phải chờ bên thứ ba)

| Việc                          | Ghi chú                                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VNPay sandbox**             | Đăng ký trên trang sandbox của VNPay để nhận `vnp_TmnCode` và `vnp_HashSecret`. **Làm đầu tiên**, vì thời gian cấp không do mình quyết định. Trong lúc chờ, cả team dùng `MockAdapter` |
| GitHub                        | Tạo repo (mục 4). Repo **private gói Free không có branch protection** → dùng repo public, hoặc GitHub Student Pack/Pro nếu có                                                         |
| Cloudflare + domain           | Chưa gấp. Cần trước tuần 2 để dựng staging                                                                                                                                             |
| VPS ≥ 8 GB (đề xuất 16 GB)    | Chưa gấp, nhưng nên có trước tuần 2–3                                                                                                                                                  |
| Sơn: Google OAuth client      | Redirect URI dev: `http://localhost:8000/api/identity/auth/google/callback` (có thể đổi sau)                                                                                           |
| Sơn: Pinata + ví Polygon Amoy | Chỉ cần tuần 5, tạo sớm cho đỡ gấp                                                                                                                                                     |

### 3.3 Thử `cloudflared` cho IPN VNPay (T-106, ~30 phút)

```bash
cloudflared tunnel --url http://localhost:3004     # payment-service dự kiến chạy cổng 3004
# In ra URL dạng https://xxxx.trycloudflare.com  → dùng làm IPN URL trong trang quản trị sandbox
```

URL này đổi mỗi lần chạy; khi dev E2E thì cập nhật lại IPN URL. Từ khi có VPS + domain, dùng domain cố định.

---

## 4. Bước 2 — Tạo repo và đẩy scaffold

```bash
unzip ticketing-platform-phase0.zip && cd ticketing-platform
git init -b main                      # PHẢI git init trước pnpm install để husky gắn hook
```

**Sửa CODEOWNERS** (thay username thật):

```bash
sed -i 's/@GH_TUAN/@username-cua-tuan/g; s/@GH_SON/@username-cua-son/g; s/@GH_VU/@username-cua-vu/g' .github/CODEOWNERS
```

**Cài và kiểm tra cục bộ:**

```bash
bash scripts/check-prereqs.sh
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test     # phải xanh hết
```

**Đẩy lên GitHub:**

```bash
gh auth login
gh repo create <org-hoac-user>/ticketing-platform --private --source=. --remote=origin   # đổi --public nếu cần
git add -A && git commit -m "chore(repo): bootstrap monorepo and infra" && git push -u origin main
```

**Nhãn + bảo vệ `main`** (cần quyền admin):

```bash
bash scripts/gh-bootstrap.sh
```

Nếu bước branch protection báo lỗi (repo private gói Free), vẫn dùng được nhãn; tự giữ kỷ luật "không push thẳng main" cho tới khi có gói phù hợp. Sau lần CI đầu tiên chạy xong, vào _Settings → Branches_ kiểm tra 2 check `build` và `security` đã được tích bắt buộc.

**Mời Sơn, Vũ** vào repo (quyền Write).

**Tạo Issue cho cả kế hoạch (90 task):**

```bash
export GH_TUAN=<username> GH_SON=<username> GH_VU=<username>
DRY_RUN=1 bash scripts/create-issues.sh | head -20      # xem trước
ONLY_WEEK=1 bash scripts/create-issues.sh                # tạo tuần 1 trước
bash scripts/create-issues.sh                            # tạo toàn bộ (hoặc để dành, tạo dần theo tuần)
```

Gợi ý: nếu sợ bị "ngợp" 90 issue, chỉ tạo tuần 1 và tạo tiếp mỗi thứ Hai (`ONLY_WEEK=2`…). Sửa plan thì chạy lại `python3 scripts/gen-issues.py` (chú ý script tạo issue **không** kiểm tra trùng, đừng chạy hai lần cho cùng một tuần).

**Tạo Projects board** (giao diện web): _Projects → New project → Board_, cột `Backlog / Ready / Doing / Review / Done`, bật workflow tự thêm Issue của repo.

---

## 5. Bước 3 — Chạy hạ tầng lần đầu

```bash
make up          # tải image lần đầu mất vài phút
make ps          # xem trạng thái
make verify      # chạy sau ~30–60 giây
```

**Kết quả mong đợi của `make verify`:** mỗi dòng `[OK]`, cuối cùng in `TẤT CẢ OK`. Bộ kiểm tra gồm: 10 database tồn tại; **`identity_user` bị từ chối khi vào `booking_db`** (chứng minh cô lập DB); Redis `PONG` và `maxmemory-policy=noeviction`; 7 topic + DLQ có mặt; MinIO, Mailpit, Kong sống.

### Lỗi thường gặp

| Triệu chứng                                                                                        | Nguyên nhân hay gặp                                                                                                                                                  | Cách xử lý                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify` báo thiếu database                                                                        | Volume Postgres đã tồn tại từ lần chạy trước nên script init **không chạy lại**                                                                                      | `make reset` (xóa sạch dữ liệu và dựng lại)                                                                                                                                                                                                                      |
| Kafka `unhealthy` / `kafka-init` lỗi                                                               | Kafka cần 20–40 giây để sẵn sàng; hoặc thiếu RAM                                                                                                                     | `make logs s=kafka`; đợi rồi `docker compose ... up -d kafka-init`; kiểm tra Docker được cấp ≥ 4 GB                                                                                                                                                              |
| `port is already allocated`                                                                        | Máy đang chạy Postgres/Redis cục bộ trên 5432/6379                                                                                                                   | Tắt dịch vụ cục bộ, hoặc đổi cổng bên trái trong `docker-compose.yml`                                                                                                                                                                                            |
| Kong trả `502` khi gọi `/api/identity/...`                                                         | Service chưa chạy (bình thường ở phase 0)                                                                                                                            | Chạy service ở cổng 3001; đảm bảo `host.docker.internal` hoạt động (Linux đã khai báo `host-gateway`)                                                                                                                                                            |
| `make verify` báo thiếu **toàn bộ** topic Kafka dù `kafka-init` đã `Exited (0)` (Windows Git Bash) | Git Bash đổi `/opt/kafka/...` thành đường dẫn Windows khi `docker exec`, lệnh liệt kê topic lỗi. Đã vá bằng `MSYS_NO_PATHCONV=1` trong Makefile và `verify-infra.sh` | Cập nhật hai file này (hoặc dùng bản zip mới), hoặc chạy trong WSL2. Kiểm tra tay: `MSYS_NO_PATHCONV=1 docker compose --env-file .env -f infra/compose/docker-compose.yml exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list` |
| `make: ... missing separator`                                                                      | File Makefile bị đổi tab thành dấu cách                                                                                                                              | Makefile bắt buộc dùng **tab** (`.editorconfig` đã khai báo)                                                                                                                                                                                                     |
| `pull access denied` / tag không tồn tại                                                           | Tên/tag image đổi                                                                                                                                                    | Báo lại cho mình; hoặc đổi phiên bản trong `.env` (`KAFKA_VERSION`, `KONG_VERSION`…)                                                                                                                                                                             |
| `bash\r: No such file`                                                                             | File shell bị CRLF khi checkout trên Windows                                                                                                                         | `.gitattributes` đã ép LF; chạy `git rm --cached -r . && git reset --hard`                                                                                                                                                                                       |
| `pnpm install` không gắn hook husky                                                                | Chưa `git init` trước khi cài                                                                                                                                        | `git init` rồi `pnpm install` lại                                                                                                                                                                                                                                |

**Sau khi mọi thứ chạy ổn, ghim phiên bản** các image đang để `latest` (MinIO, mc, Mailpit, Kafka UI, Adminer): chạy `docker compose -f infra/compose/docker-compose.yml images`, ghi tag cụ thể vào `.env`/compose rồi commit. Tránh việc một ngày image đổi làm cả team hỏng môi trường.

**Đo RAM (phần của T-106):**

```bash
docker stats --no-stream      # ghi lại tổng RAM hạ tầng vào docs/test-reports/ram-phase0.md
```

---

## 6. Bước 4 — Onboarding Sơn và Vũ

Gửi tin nhắn dưới đây (sửa link repo):

> **Phase 0 xong. Việc cần làm trong 30 phút đầu:**
>
> 1. Nhận lời mời repo, `git clone`, đọc `README.md` và `CONTRIBUTING.md`.
> 2. `git config core.autocrlf input` (Windows) rồi `bash scripts/check-prereqs.sh`.
> 3. `cp .env.example .env && pnpm install && make up`, đợi 1 phút rồi `make verify` — gửi ảnh chụp kết quả vào nhóm.
> 4. Vào Projects board, nhận các issue tuần 1 của mình (`owner:son` / `owner:vu`).
> 5. Quy tắc: không push thẳng `main`; commit theo Conventional Commits; mã lõi cần 2 người đọc.

**Ai làm gì ngay trong ngày đầu (khi template service T-102 chưa xong):**

| Người   | Làm ngay (không phụ thuộc T-102)                                                                                         | Chờ T-102 mới làm                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| **Vũ**  | V-101 (khởi tạo `apps/web`, `apps/staff-pwa`), V-105 (wireframe), V-104 (dữ liệu seed)                                   | V-102/V-103 cần OpenAPI identity của Sơn      |
| **Sơn** | Soạn SQL migration identity (S-101) dưới dạng file SQL thuần, viết thiết kế token/refresh rotation, đọc ADR-0004 và 0005 | Gắn vào service (S-101…S-106) khi có template |

---

## 7. Lịch gợi ý cho Tuấn: tuần 1

| Ngày                  | Việc                                                                           | Kết quả bàn giao                |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| **Ngày 0 (trước T2)** | Mục 3, 4, 5: tài khoản, repo, `make up` xanh, tạo Issue tuần 1                 | Sơn/Vũ clone về chạy được       |
| **T2**                | Họp khởi động 60 phút + hoàn tất phase 0; bắt đầu **T-102** (template service) | Repo + hạ tầng sẵn sàng         |
| **T3**                | Xong **T-102**, mở PR; Sơn bắt đầu gắn identity vào template                   | Sơn không còn bị chặn           |
| **T4**                | **T-103** (`outbox-inbox`) + họp sync hợp đồng 30 phút                         | Thư viện có test Testcontainers |
| **T5**                | **T-105** hoàn thiện CI, **T-107** workshop chốt contract + ADR                | Contract v1 và ADR được merge   |
| **T6**                | Demo tuần 1 + retro, sửa nợ kỹ thuật                                           | Qua cổng nghiệm thu tuần 1      |

Lưu ý: tuần 1 của bạn xếp 5,0 ngày công, tức **không có buffer**. Nếu T-102 hoặc T-103 trễ, ưu tiên T-102 (chặn cả nhóm), còn T-103 có thể lùi sang đầu tuần 2 vì booking chưa cần outbox cho tới T-301.

---

## 8. Workshop T-107 (60–90 phút, cả nhóm)

**Chuẩn bị:** mọi người đọc `packages/event-contracts` và `docs/adr/` trước.

**Cần chốt:**

1. **Envelope:** đổi `event_id` thành `message_id` (đã làm trong bản nháp để khỏi nhầm với `event_id` của sự kiện ca nhạc) — đồng ý không?
2. **Danh sách sự kiện và trường dữ liệu** của 22 loại sự kiện: Sơn rà `EventApproved`, `TicketIssued`; Vũ rà `Stock*`; Tuấn rà `Order*`, `Payment*`.
3. **Chính sách giải ngân escrow** (đang để mặc định: khi buyer check-in thành công hoặc 24 giờ sau khi sự kiện kết thúc).
4. **Quy ước API chung:** tiền tố `/v1`, định dạng lỗi (đề xuất RFC 7807 `application/problem+json`), phân trang (đề xuất cursor), header `Idempotency-Key`, `X-Request-Id`, múi giờ (UTC, ISO-8601).
5. **ADR-0001…0008:** rà từng cái, đổi trạng thái sang "Đã chấp nhận" hoặc sửa.
6. **Kỷ luật hợp đồng:** ai được sửa `event-contracts`, quy tắc tăng `version`.

---

## 9. Chốt công nghệ cho T-102 (bước kế tiếp của bạn)

Template service là thứ cả team dùng nhiều nhất, nên chốt các lựa chọn sau **trước khi viết**. Đây là **đề xuất của mình**, bạn quyết định:

| Hạng mục        | Đề xuất                                                        | Lý do / lưu ý                                                                                                                                       |
| --------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | NestJS (Express adapter mặc định)                              | Quen thuộc, nhiều tài liệu. Nếu đo thấy `booking` nghẽn ở HTTP thì mới cân nhắc Fastify adapter                                                     |
| ORM/migration   | **Prisma** với `migrate dev --create-only` rồi **sửa tay SQL** | Cần partial unique index, `FOR UPDATE SKIP LOCKED`, trigger append-only, những thứ Prisma không mô hình hóa. Chấp nhận viết SQL tay trong migration |
| Kafka client    | `kafkajs`                                                      | Đơn giản, đủ dùng. Producer idempotent, `acks=all`                                                                                                  |
| Redis client    | `ioredis`                                                      | Hỗ trợ Lua (`defineCommand`), pub/sub, Sentinel                                                                                                     |
| JWT             | `jose`                                                         | Verify RS256 + JWKS có cache, làm mới khi gặp `kid` lạ (ADR-0004)                                                                                   |
| Logger          | `pino` (JSON, kèm `request_id`/`trace_id`)                     | Nhanh, phù hợp Loki                                                                                                                                 |
| Validation      | `zod` (đã dùng ở contracts) hoặc `class-validator`             | Chọn một, dùng thống nhất                                                                                                                           |
| Test            | Jest + Testcontainers (Vitest ở FE và contracts)               | Nên thống nhất Jest cho service NestJS                                                                                                              |
| Mã `auth-guard` | Gói riêng `packages/auth-guard`                                | Mọi service dùng chung, đừng copy                                                                                                                   |

---

## 10. Việc Tuấn cần quyết hoặc lưu ý (tóm tắt)

1. **Một điều chỉnh so với tài liệu trước:** Kong bản OSS không tự lấy JWKS, nên **verify JWT thực hiện trong từng service** bằng `auth-guard` (ADR-0004). Kong chỉ làm routing, CORS, rate limit, request-id. Mình đã sửa mục 3.2 trong tài liệu kiến trúc và task T-206 trong plan cho khớp. Đây là sai sót của bản trước, không phải lựa chọn mới.
2. **Task T-104** đã đổi cách mô tả: hạ tầng luôn chạy bằng `make up`; profile `tools` chỉ cho giao diện xem dữ liệu. Lệnh `docker compose --profile core up` trong plan cũ đã đổi thành `make up`.
3. **Tải tuần 1 của bạn là 5,0 ngày** (trước đây ghi nhầm 4,75); tổng 6 tuần là 27,5 ngày. Đã sửa trong plan.
4. **Rủi ro cô lập DB ở dev:** vì dùng chung một Postgres server, `make verify` chứng minh được cô lập quyền truy cập, nhưng một lỗi cấu hình có thể làm user admin bị dùng nhầm. **Quy ước:** service chỉ dùng `<name>_user`, không bao giờ dùng `postgres`.
5. **Redis `noeviction`** là chủ ý (key giữ ghế là dữ liệu, không phải cache). Khi Redis đầy, ghi sẽ lỗi thay vì lặng lẽ xóa key giữ ghế. Cache trang sự kiện cần đặt TTL và giới hạn kích thước riêng.
6. **Kong rate limit** đang để 1.200 request/phút/IP: đủ cho dev nhưng sẽ chặn load test. Tuần 4 tạo `kong.loadtest.yml` riêng thay vì sửa file này.

---

## 11. Cheat sheet

```bash
make up | down | reset | ps | verify | tools | kong-reload
make logs s=kafka            # log một service hạ tầng
make psql s=booking          # psql vào booking_db bằng booking_user
make redis-cli
pnpm build | lint | typecheck | test | format
python3 scripts/gen-issues.py            # sinh lại scripts/issues.tsv từ plan
DRY_RUN=1 bash scripts/create-issues.sh  # xem trước khi tạo issue
```

**Chuỗi kết nối mẫu (copy sang `.env` của từng service):**

```
DATABASE_URL=postgresql://booking_user:booking_dev@localhost:5432/booking_db
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:9092
SMTP_HOST=localhost  SMTP_PORT=1025
```
