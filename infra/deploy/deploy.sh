#!/usr/bin/env bash
# Chạy bởi Tuấn trên host đích; script không SSH, không tạo DNS, không xóa volume.
set -euo pipefail
# Tác vụ deploy không tương tác; -T chỉ tắt TTY, không đóng stdin của Compose.
exec </dev/null

fail() { printf 'Deploy failed: %s\n' "$*" >&2; exit 1; }
if (( $# != 1 && $# != 2 && $# != 4 )); then
  fail 'usage: bash infra/deploy/deploy.sh /absolute/path/.env.prod [health-timeout-seconds] [--tunnel /absolute/path/token]'
fi
env_file="$1"
health_timeout="${2:-180}"
[[ "$env_file" = /* && -r "$env_file" && -f "$env_file" ]] || fail 'env file must be an existing, readable absolute path'
[[ "$health_timeout" =~ ^[1-9][0-9]{0,3}$ ]] || fail 'health timeout must be a positive integer (max 3600)'
(( health_timeout <= 3600 )) || fail 'health timeout must be at most 3600 seconds'
command -v docker >/dev/null || fail 'docker is not installed'
command -v timeout >/dev/null || fail 'GNU timeout is required'

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
compose=(docker compose --project-name ticketing-prod --env-file "$env_file" -f "$repo_root/infra/compose/docker-compose.prod.yml")
if (( $# == 4 )); then
  [[ "$3" == --tunnel ]] || fail 'expected --tunnel before token file path'
  [[ "$4" = /* && -f "$4" && -r "$4" && -s "$4" ]] || fail 'token file must be an existing, readable, nonempty absolute file'
  # Chỉ đường dẫn được export cho Compose; nội dung token không vào env/argv/log.
  export CLOUDFLARED_TOKEN_FILE="$4"
  compose+=(-f "$repo_root/infra/compose/docker-compose.tunnel.yml")
fi
docker compose version >/dev/null
# --quiet tránh ghi toàn bộ env chứa secret ra terminal/log CI.
"${compose[@]}" config --quiet
images="$("${compose[@]}" --profile bootstrap config --images)"
while IFS= read -r image; do
  [[ "$image" =~ @sha256:[a-f0-9]{64}$ ]] || fail 'every image must be pinned by sha256 digest'
done <<< "$images"

printf 'Pulling pinned infrastructure images...\n'
"${compose[@]}" --profile bootstrap pull
printf 'Starting infrastructure and waiting for health checks...\n'
"${compose[@]}" up -d --no-build --wait --wait-timeout "$health_timeout"

# MinIO distroless không có curl/wget. Redis Alpine đã có BusyBox wget,
# dùng HTTP readiness qua backend; không cài thêm package hoặc publish MinIO ra host.
wait_http() {
  local label="$1" url="$2" deadline=$((SECONDS + health_timeout))
  local remaining attempt
  while true; do
    remaining=$((deadline - SECONDS))
    (( remaining > 0 )) || fail "$label readiness timed out"
    attempt=$remaining
    (( attempt <= 8 )) || attempt=8
    if timeout --kill-after=2 "$attempt" "${compose[@]}" exec -T --interactive=false redis /bin/busybox wget -q -T 5 -O /dev/null "$url"; then
      return 0
    fi
    (( SECONDS < deadline )) || fail "$label readiness timed out"
    sleep 1
  done
}
wait_http MinIO http://minio:9000/minio/health/ready
wait_http Kong http://kong:8000/health/infra

printf 'Initializing Kafka topics idempotently...\n'
timeout --kill-after=2 "$health_timeout" "${compose[@]}" run -T --interactive=false --rm --no-deps kafka-init
"${compose[@]}" ps
if (( $# == 4 )); then
  printf 'Connector readiness passed. Public HTTPS still requires external verification.\n'
fi
printf 'Infrastructure health checks passed. Application images are not enabled.\n'
