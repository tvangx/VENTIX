#!/bin/sh
# Tạo topic theo Tài liệu KT mục 4. Chạy lặp lại an toàn (--if-not-exists).
set -eu
BOOTSTRAP="${KAFKA_BOOTSTRAP:-kafka:29092}"
KT=/opt/kafka/bin/kafka-topics.sh
WEEK=604800000     # 7 ngày
MONTH=2592000000   # 30 ngày

create() { # tên, số partition, retention.ms
  "$KT" --bootstrap-server "$BOOTSTRAP" --create --if-not-exists \
    --topic "$1" --partitions "$2" --replication-factor 1 --config "retention.ms=$3"
}

# topic nóng: 6 partition
create booking.orders   6 "$WEEK"
create payment.events   6 "$WEEK"
# còn lại: 3 partition
create event.lifecycle  3 "$WEEK"
create merch.stock      3 "$WEEK"
create ticket.events    3 "$WEEK"
create resale.events    3 "$WEEK"
create audit.events     3 "$MONTH"
# dead-letter
for t in booking.orders payment.events event.lifecycle merch.stock ticket.events resale.events audit.events; do
  create "$t.dlq" 1 "$MONTH"
done

echo "== topics =="
"$KT" --bootstrap-server "$BOOTSTRAP" --list
