import { Counter, Histogram, Registry } from "prom-client";

export interface OutboxRelayMetrics {
  registry: Registry;
  /** Số dòng đã publish và đánh dấu `published_at`. */
  published: Counter;
  /** Số lần một lượt poll thất bại (lỗi DB hoặc Kafka). */
  errors: Counter;
  /** Độ trễ từ `created_at` đến lúc publish thành công (giây). */
  lag: Histogram;
}

/**
 * Tạo metric của relay. Truyền `registry` của service để `/metrics` xuất luôn;
 * mỗi registry chỉ đăng ký được MỘT relay (prom-client không cho trùng tên).
 */
export function createRelayMetrics(registry: Registry = new Registry()): OutboxRelayMetrics {
  return {
    registry,
    published: new Counter({
      name: "outbox_relay_published_total",
      help: "Outbox rows published to Kafka",
      registers: [registry],
    }),
    errors: new Counter({
      name: "outbox_relay_errors_total",
      help: "Failed outbox relay polls",
      registers: [registry],
    }),
    lag: new Histogram({
      name: "outbox_relay_publish_lag_seconds",
      help: "Delay between outbox row creation and successful publish",
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
      registers: [registry],
    }),
  };
}
