# Tạo service mới (dưới 1 giờ)

Dành cho Sơn/Vũ. Template ở `services/_template`; script sao chép và thay `__SERVICE__`, `__PORT__`, tên package.

```bash
bash scripts/new-service.sh event 3002                 # tên phải thuộc: identity event booking payment ticket resale merch notification finance ai
pnpm install
cp services/event/.env.example services/event/.env     # .env không được commit
make up && make verify                                 # Postgres có sẵn DB/user event_db/event_user
pnpm --filter @ticketing/event dev                     # GET http://localhost:3002/health/ready → 200
```

Cổng dev: xem `AGENTS.md` mục 1. Chạy trên Windows bằng Git Bash hoặc WSL (script dùng bash, file LF).

## Việc cần làm ngay sau khi sinh

1. **Xóa endpoint mẫu** `src/modules/whoami/` và bỏ khỏi `app.module.ts` khi có module thật.
2. **Đặt biến `AUTH_*`**: `AUTH_JWKS_URI` (identity-service, dùng mọi môi trường thật) hoặc `AUTH_PUBLIC_KEY_PEM` (chỉ dev/test; bị cấm khi `NODE_ENV=production`). Mặc định mọi route cần JWT; mở route bằng `@Public()`, giới hạn role bằng `@Roles("ORGANIZER")`, lấy user bằng `@CurrentUser()`.
3. **Prisma:** schema chưa có model (Prisma 5 không generate được client khi trống; `scripts/prisma-generate.js` tự bỏ qua). Khi thêm model đầu tiên:
   `pnpm --filter @ticketing/<name> prisma:migrate:create --name init` rồi **sửa tay file SQL** (CONVENTIONS mục 5), sau đó thêm `PrismaService` (class `extends PrismaClient`, ctor `super({ datasourceUrl: env.DATABASE_URL })`, `$disconnect` ở `onModuleDestroy`) vào một module và dùng trong repository.
4. **Env mới:** thêm vào `config/env.schema.ts` **và** `.env.example`. Không đọc `process.env` ở nơi khác.
5. **OpenAPI:** `pnpm --filter @ticketing/<name> openapi:export`, commit `openapi.json`.
6. **Docker:** `docker build -f services/<name>/Dockerfile -t ticketing/<name> .` (build từ thư mục gốc repo).

## Test

- Unit: `pnpm --filter @ticketing/<name> test`
- Integration (Testcontainers, cần Docker): `... test:int`; mẫu ở `test/integration/health.int-spec.ts`
- Concurrency: `... test:conc` (đặt file ở `test/concurrency/*.conc-spec.ts`)

## Lưu ý

- Chỉ thêm tên ngoài danh sách bằng `--force-name` khi thử (ví dụ `demo`); sau khi thử hãy **xóa** thư mục service đó.
- Cổng đã dùng bởi service khác sẽ bị từ chối.
- `/metrics` chỉ cho Prometheus nội bộ, không route qua Kong.
