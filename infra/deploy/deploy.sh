#!/usr/bin/env bash
# Chạy bởi Tuấn trên host đích; script không SSH, không tạo DNS, không xóa volume.
set -euo pipefail

fail() { printf 'Deploy failed: %s\n' "$*" >&2; exit 1; }
if (( $# < 1 || $# > 2 )); then
  fail 'usage: bash infra/deploy/deploy.sh /absolute/path/.env.prod [health-timeout-seconds]'
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
  until timeout 8 "${compose[@]}" exec -T redis /bin/busybox wget -q -T 5 -O /dev/null "$url"; do
    (( SECONDS < deadline )) || fail "$label readiness timed out"
    sleep 2
  done
}
wait_http MinIO http://minio:9000/minio/health/ready
wait_http Kong http://kong:8000/health/infra

printf 'Initializing Kafka topics idempotently...\n'
timeout "$health_timeout" "${compose[@]}" run --rm --no-deps kafka-init
"${compose[@]}" ps
printf 'Infrastructure health checks passed. Application images are not enabled.\n'
