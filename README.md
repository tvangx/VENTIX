# Ticketing Platform — Đồ án tốt nghiệp

Nền tảng Web SaaS phân phối vé sự kiện, merchandise và sàn resale. Kiến trúc microservices, database-per-service, xử lý đồng thời cao (Waiting Room + Redis Lua + PostgreSQL unique index), Kafka + Outbox/Inbox.

Nhóm: **Tuấn** (lead, platform & concurrency) · **Sơn** (backend domain) · **Vũ** (frontend, merch, notification)

> **Tuấn:** làm theo `START_HERE.md`. Prompt cho agent: `docs/agent/PROMPTS.md`.

## Bắt đầu trong 10 phút

```bash
git clone <repo-url> && cd ticketing-platform
bash scripts/check-prereqs.sh      # kiểm tra Node 20+, pnpm, Docker, make
cp .env.example .env               # hoặc: make env
pnpm install
make up                            # bật Postgres, Redis, Kafka, MinIO, Mailpit, Kong
make verify                        # chờ ~30-60 giây rồi chạy: phải ra "TẤT CẢ OK"
```

Windows: khuyến nghị **WSL2** (Docker Desktop bật WSL integration). Git Bash cũng chạy được vì `Makefile` và `verify-infra.sh` đã tắt tự đổi đường dẫn (`MSYS_NO_PATHCONV=1`); nếu tự gõ `docker exec ... /opt/...` trong Git Bash, hãy đặt `MSYS_NO_PATHCONV=1` trước lệnh.

## Cổng và địa chỉ (dev)

| Thành phần                           | Địa chỉ                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Kong (cổng vào API)                  | http://localhost:8000 — route dạng `/api/<service>/...`                                  |
| Kong admin (chỉ đọc)                 | http://localhost:8001                                                                    |
| PostgreSQL                           | localhost:5432 — mỗi service: DB `<name>_db`, user `<name>_user` (mật khẩu trong `.env`) |
| Redis                                | localhost:6379                                                                           |
| Kafka (từ máy host) / (từ container) | localhost:9092 / kafka:29092                                                             |
| MinIO API / Console                  | http://localhost:9000 / http://localhost:9001                                            |
| Mailpit (email dev)                  | http://localhost:8025 (SMTP 1025)                                                        |
| Kafka UI, Adminer (`make tools`)     | http://localhost:8089, http://localhost:8088                                             |

Cổng ứng dụng: identity **3001**, event **3002**, booking **3003**, payment **3004**, ticket **3005**, resale **3006**, merch **3007**, notification **3008**, finance **3009**; web **5173**, staff-pwa **5174**.

Chuỗi kết nối mẫu: `postgresql://booking_user:booking_dev@localhost:5432/booking_db`

## Cấu trúc

```
apps/        web (Vũ), staff-pwa (Vũ)
services/    identity, event, booking, payment, ticket, resale, merch, notification, finance
packages/    event-contracts (hợp đồng Kafka), outbox-inbox (T-103), + auth-guard/logger/otel (T-102)
infra/       compose, postgres/init, kafka, kong
docs/        adr, architecture (kiến trúc + plan 6 tuần), sequence, erd, test-reports
scripts/     check-prereqs, verify-infra, gh-bootstrap, create-issues, gen-issues
```

## Lệnh hay dùng

`make help` · `make up` · `make down` · `make reset` (xóa sạch dữ liệu) · `make logs s=kafka` · `make psql s=booking` · `make redis-cli` · `make tools` · `make kong-reload`

`pnpm build | lint | typecheck | test | format`

## Tài liệu

- Kiến trúc & thiết kế: `docs/architecture/architecture-v2.md`
- Kế hoạch 6 tuần chi tiết từng người: `docs/architecture/plan-6-weeks.md`
- Quyết định kiến trúc: `docs/adr/`
- Quy tắc làm việc: `CONTRIBUTING.md`
