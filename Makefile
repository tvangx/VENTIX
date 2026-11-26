# Git Bash (MINGW) trên Windows: tắt tự đổi đường dẫn khi gọi docker exec
export MSYS_NO_PATHCONV=1

COMPOSE = docker compose --env-file .env -f infra/compose/docker-compose.yml
OBS_ENV ?= /etc/ticketing/.env.obs
OBS_PROJECT ?= ticketing-prod

.PHONY: help env up down reset ps logs tools verify psql redis-cli kong-reload kong-loadtest kong-routes

help: ## Liệt kê lệnh
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-14s %s\n",$$1,$$2}'

env: ## Tạo .env từ .env.example nếu chưa có
	@test -f .env || (cp .env.example .env && echo "đã tạo .env")

up: env ## Bật hạ tầng (Postgres, Redis, Kafka, MinIO, Mailpit, Kong)
	$(COMPOSE) up -d
	@echo "Chờ vài chục giây rồi chạy: make verify"

down: ## Tắt hạ tầng (giữ dữ liệu)
	$(COMPOSE) down

reset: ## XÓA SẠCH dữ liệu và dựng lại từ đầu
	$(COMPOSE) down -v
	$(MAKE) up

ps: ## Trạng thái container
	$(COMPOSE) ps -a

logs: ## Xem log, ví dụ: make logs s=kafka
	$(COMPOSE) logs -f --tail=100 $(s)

tools: env ## Bật thêm Kafka UI (8089) và Adminer (8088)
	$(COMPOSE) --profile tools up -d

verify: ## Kiểm tra toàn bộ hạ tầng đã sẵn sàng
	@bash scripts/verify-infra.sh

psql: ## Vào psql của 1 service, ví dụ: make psql s=booking
	$(COMPOSE) exec -e PGPASSWORD=$${DB_PASSWORD_$(shell echo $(s) | tr a-z A-Z):-$(s)_dev} postgres psql -U $(s)_user -d $(s)_db

redis-cli: ## Vào redis-cli
	$(COMPOSE) exec redis redis-cli

kong-reload: ## Nạp lại kong.yml (DB-less)
	$(COMPOSE) restart kong

kong-loadtest: ## Nạp hạn mức nới cho load test LOCAL; khôi phục bằng make kong-reload
	@curl --fail-with-body --silent --show-error --max-time 30 --request POST http://localhost:8001/config --form config=@infra/kong/kong.loadtest.yml > /dev/null

kong-routes: ## Xem route Kong đang nạp
	@curl -s localhost:8001/routes | head -c 2000; echo

.PHONY: obs-check obs-up obs-down
obs-check: ## Kiểm tra cấu hình observability, không đổi ứng dụng
	@bash infra/obs/obs.sh check "$(OBS_ENV)" "$(OBS_PROJECT)"

obs-up: ## Bật riêng Prometheus/Grafana
	@bash infra/obs/obs.sh start "$(OBS_ENV)" "$(OBS_PROJECT)"

obs-down: ## Dừng riêng Prometheus/Grafana, giữ volume và ứng dụng
	@bash infra/obs/obs.sh stop "$(OBS_ENV)" "$(OBS_PROJECT)"
