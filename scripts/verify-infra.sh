#!/usr/bin/env bash
# Kiểm tra hạ tầng dev. Thoát mã != 0 nếu có mục lỗi.
set -u
# Git Bash (MINGW) trên Windows tự đổi /opt/... thành C:/Program Files/Git/opt/... khi gọi docker exec
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
C="docker compose --env-file .env -f infra/compose/docker-compose.yml"
fail=0
ok()  { printf "  [OK]   %s\n" "$1"; }
bad() { printf "  [FAIL] %s\n" "$1"; fail=1; }

echo "== PostgreSQL: 10 database, mỗi service 1 user =="
dbs=$($C exec -T postgres psql -U "${POSTGRES_ADMIN_USER:-postgres}" -Atc "select datname from pg_database where datname like '%\_db' order by 1" 2>/dev/null)
for d in identity event booking payment ticket resale merch notification finance ai; do
  echo "$dbs" | grep -qx "${d}_db" && ok "${d}_db" || bad "${d}_db chưa tồn tại"
done

echo "== Cô lập DB: identity_user KHÔNG được vào booking_db =="
if $C exec -T -e PGPASSWORD="${DB_PASSWORD_IDENTITY:-identity_dev}" postgres psql -U identity_user -d booking_db -c "select 1" >/dev/null 2>&1; then
  bad "identity_user truy cập được booking_db (sai cô lập)"
else
  ok "identity_user bị từ chối khi vào booking_db"
fi

echo "== Redis =="
[ "$($C exec -T redis redis-cli ping 2>/dev/null | tr -d '\r')" = "PONG" ] && ok "PING" || bad "redis không phản hồi"
pol=$($C exec -T redis redis-cli config get maxmemory-policy 2>/dev/null | tail -1 | tr -d '\r')
[ "$pol" = "noeviction" ] && ok "maxmemory-policy=noeviction" || bad "maxmemory-policy=$pol (phải là noeviction)"

echo "== Kafka topics =="
topics=$($C exec -T kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list 2>/tmp/verify-kafka.err)
if [ -z "$topics" ]; then
  echo "  (không liệt kê được topic. Lỗi từ kafka-topics: $(head -c 300 /tmp/verify-kafka.err 2>/dev/null))"
fi
for t in event.lifecycle booking.orders merch.stock payment.events ticket.events resale.events audit.events booking.orders.dlq; do
  echo "$topics" | grep -qx "$t" && ok "$t" || bad "thiếu topic $t (xem: make logs s=kafka-init)"
done

echo "== MinIO / Mailpit / Kong =="
curl -fs localhost:9000/minio/health/live >/dev/null && ok "minio :9000" || bad "minio"
curl -fs localhost:8025/api/v1/info >/dev/null && ok "mailpit UI :8025" || bad "mailpit"
code=$(curl -s -o /dev/null -w "%{http_code}" localhost:8000/)
[ "$code" = "404" ] && ok "kong proxy :8000 (404 'no route' là bình thường)" || bad "kong proxy trả $code"
curl -fs localhost:8001/routes >/dev/null && ok "kong admin :8001" || bad "kong admin"

echo
[ $fail -eq 0 ] && echo "TẤT CẢ OK" || echo "CÓ MỤC LỖI — xem hướng dẫn xử lý trong docs"
exit $fail
