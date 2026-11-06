#!/usr/bin/env bash
# Smoke test trên Kong dev thật. Không cần token; không sửa cấu hình gateway.
# Sau khi chỉnh quota YAML: bash scripts/check-kong.sh <holds> <checkout> <join>
set -euo pipefail
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."

base=http://localhost:8000
limits=("${1:-60}" "${2:-20}" "${3:-30}")
paths=(holds checkout queue/join)
for limit in "${limits[@]}"; do
  [[ "$limit" =~ ^[1-9][0-9]*$ ]] && ((limit <= 1000)) || {
    echo 'FAIL: quota phải là số nguyên 1..1000; không chạy smoke test trên loadtest config.' >&2
    exit 1
  }
done
work=$(mktemp -d)
# MSYS_NO_PATHCONV tắt chuyển path cho cả curl.exe: dùng path Windows cho file tạm.
if command -v cygpath >/dev/null 2>&1; then
  work=$(cygpath -m "$work")
fi
trap 'rm -f "$work/headers" "$work/body" "$work/payload"; rmdir "$work"' EXIT
passed=0
ok() { passed=$((passed + 1)); printf '[OK] %s\n' "$*"; }
die() { printf '[FAIL] %s (HTTP %s)\n' "$*" "${status:-unknown}" >&2; exit 1; }
header() {
  awk -v key="$1" 'tolower($1) == tolower(key ":") { sub(/^[^:]+:[ \t]*/, ""); sub(/\r$/, ""); print; exit }' "$work/headers"
}
request() {
  status=$(curl --silent --show-error --path-as-is --connect-timeout 2 --max-time 5 \
    -D "$work/headers" -o "$work/body" -w '%{http_code}' "$@") || die 'curl thất bại'
}
request_id() { [[ -n "$(header X-Request-Id)" ]] || die 'thiếu X-Request-Id'; }
internal_404() {
  [[ "$status" == 404 ]] || die "internal không bị chặn: $*"
  [[ "$(cat "$work/body")" == '{"message":"Not found"}' ]] || die 'sai body termination'
  [[ -n "$(header X-Kong-Response-Latency)" && -z "$(header X-Kong-Upstream-Latency)" ]] || die '404 không phải từ Kong'
  request_id
}

# Poll có timeout sau make kong-reload; không chờ cố định container khởi động.
ready=0
for ((attempt = 0; attempt < 30; attempt++)); do
  if curl --silent --fail --connect-timeout 1 --max-time 2 http://localhost:8001/status >/dev/null; then
    ready=1; break
  fi
  sleep 1
done
[[ "$ready" == 1 ]] || die 'Kong chưa sẵn sàng sau 30 lần poll'

for origin in http://localhost:5173 http://localhost:5174; do
  request -X OPTIONS "$base/api/booking/v1/holds" -H "Origin: $origin" \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: authorization,content-type,idempotency-key,x-request-id'
  [[ "$status" == 200 || "$status" == 204 ]] || die 'CORS preflight bị từ chối'
  [[ "$(header Access-Control-Allow-Origin)" == "$origin" ]] || die 'sai CORS origin'
  [[ "$(header Access-Control-Allow-Credentials)" == true ]] || die 'thiếu CORS credentials'
  [[ "$(header Access-Control-Allow-Methods)" == *POST* ]] || die 'CORS thiếu POST'
  allowed=$(header Access-Control-Allow-Headers | tr '[:upper:]' '[:lower:]')
  for name in authorization content-type idempotency-key x-request-id; do
    [[ "$allowed" == *"$name"* ]] || die "CORS thiếu header $name"
  done
  request_id
  ok "CORS preflight + request-id: $origin"
done

# Dùng path không có side effect; kiểm tra cả ID do client gửi và ID Kong sinh.
request "$base/api/event/v1/health/live" -H 'X-Request-Id: t206-smoke-request'
[[ "$(header X-Request-Id)" == t206-smoke-request ]] || die 'không echo request-id'
ok 'X-Request-Id do client gửi được echo'

# Phải fail nếu internal rơi xuống route public, kể cả OPTIONS/CORS.
for service in identity event booking payment ticket resale merch notification finance unknown; do
  for method in GET POST PUT PATCH DELETE OPTIONS HEAD; do
    method_args=(-X "$method")
    [[ "$method" != HEAD ]] || method_args=(--head)
    request "${method_args[@]}" "$base/api/$service/v1/internal/events/x/seat-classes" \
      -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: POST'
    # HEAD không có body theo HTTP; kiểm tra bằng GET riêng trong cùng vòng.
    if [[ "$method" == HEAD ]]; then
      [[ "$status" == 404 && -n "$(header X-Kong-Response-Latency)" && -z "$(header X-Kong-Upstream-Latency)" ]] || die 'HEAD internal không bị Kong chặn'
      request_id
    else
      internal_404 "$service/$method"
    fi
    ok "internal $service $method => 404 từ Kong"
  done
done
for path in \
  /api/event/v1/internal /api/event/v1/internal/ /api/event/v1/internal-other \
  /api/event/v1/INTERNAL/events/x/seat-classes /api/event/V1/Internal/events/x/seat-classes \
  /api/event/v1/%69nternal/events/x/seat-classes \
  /api/event//v1/internal/events/x/seat-classes \
  /api/event/v1/public/../internal/events/x/seat-classes \
  /api/event/v1/internal/events/x/seat-classes?probe=1; do
  request "$base$path"
  internal_404 "$path"
  ok "internal path $path"
done

# Thiếu token và body {}: không tạo hold/order hay tham gia queue hợp lệ.
# Đọc quota mỗi route trước, sau đó làm cạn từng bucket và thử lại các route còn lại.
for i in 0 1 2; do
  request -X POST "$base/api/booking/v1/${paths[$i]}" -H 'Content-Type: application/json' --data '{}'
  [[ "$(header X-RateLimit-Limit-Minute)" == "${limits[$i]}" ]] || die "sai quota ${paths[$i]}"
  request_id
  ok "quota ${paths[$i]} = ${limits[$i]}/phút/IP"
done
for i in 0 1 2; do
  count=0
  # Cho phép đi qua một ranh giới phút; không coi 429 của upstream là bằng chứng.
  while ((count < 2 * limits[i] + 5)); do
    request -X POST "$base/api/booking/v1/${paths[$i]}" -H 'Content-Type: application/json' --data '{}'
    count=$((count + 1))
    [[ "$(header X-RateLimit-Limit-Minute)" == "${limits[$i]}" ]] || die 'route rơi xuống quota mặc định'
    if [[ "$status" == 429 ]]; then
      [[ "$(header Retry-After)" =~ ^[1-9][0-9]*$ && -z "$(header X-Kong-Upstream-Latency)" ]] || die '429 không phải từ Kong'
      request_id
      break
    fi
  done
  [[ "$status" == 429 ]] || die "không nhận 429 cho ${paths[$i]} sau $count request"
  ok "${paths[$i]} => 429 sau $count request trong vòng lặp, Retry-After=$(header Retry-After), request-id có mặt"
  for ((j = i + 1; j < 3; j++)); do
    request -X POST "$base/api/booking/v1/${paths[$j]}" -H 'Content-Type: application/json' --data '{}'
    [[ "$status" != 429 && "$(header X-RateLimit-Limit-Minute)" == "${limits[$j]}" ]] || die 'bucket rate limit không độc lập'
    ok "${paths[$j]} còn quota sau khi ${paths[$i]} hết quota"
  done
done

request "$base/api/booking/V1/HOLDS"
[[ "$(header X-RateLimit-Limit-Minute)" == "${limits[0]}" ]] || die 'đổi chữ hoa né được quota holds'
ok 'V1/HOLDS dùng cùng quota holds (Express không phân biệt hoa thường)'

request "$base/api/booking/v1/holds-other"
[[ "$(header X-RateLimit-Limit-Minute)" == 1200 ]] || die 'boundary holds khớp quá rộng'
ok 'holds-other dùng quota service 1200, không dùng quota holds'
request "$base/api/booking/v1/internal/holds"
internal_404 'booking sau khi hết quota'
ok 'internal vẫn 404 sau khi hết quota public'

# Body >2 MiB cũng không tới service nội bộ hay bị thay bằng 413.
head -c 2097153 /dev/zero > "$work/payload"
request -X POST "$base/api/event/v1/internal/events/x/seat-classes" --data-binary "@$work/payload"
internal_404 'body lớn'
ok 'internal body >2 MiB vẫn 404 từ Kong'
printf 'PASS: %s checks; 0 failed\n' "$passed"
