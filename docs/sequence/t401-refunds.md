# T-401 — Refund, đối soát và hủy sự kiện

```mermaid
sequenceDiagram
  participant K as Kafka
  participant P as Payment
  participant D as payment_db
  participant W as Refund worker
  participant V as Provider
  participant B as Booking
  K->>P: OrderCancelled LATE_PAYMENT / EventCancelled
  P->>D: TX Inbox + refund/batch (UNIQUE payment_id)
  Note over P,D: EventCancelled và callback dùng chung khóa theo event
  W->>D: TX quota + SKIP LOCKED + sent_at + lease/token
  D-->>W: Commit claim
  W->>V: refund (chỉ khi chưa có dấu gửi)
  alt Refund thành công được xác thực
    W->>D: TX conditional claim/version + SUCCEEDED + Outbox RefundCompleted
    D-->>K: Outbox relay
    K->>B: RefundCompleted
    Note over B: Inbox + CONFIRMED/REFUND_REQUIRED sang REFUNDED
  else Timeout / đang xử lý / chưa rõ
    W->>D: PENDING + backoff, giữ sent_at
    W->>D: Claim tiếp theo qua cùng quota
    W->>V: Chỉ query/đối soát
    alt Có bằng chứng refund xác thực được
      W->>D: TX SUCCEEDED + Outbox RefundCompleted
    else Chưa đủ bằng chứng
      W->>D: NEEDS_MANUAL, giữ sent_at
      Note over W,D: Admin retry chỉ query, không xóa dấu gửi
    end
  end
  K->>B: EventCancelled
  Note over B: TX Inbox + CANCELLED order chưa hoàn tất + nhả allocation/GA + Outbox + RELEASE work
```

VNPay hiện không có đường đối soát tự động đủ chứng cứ trong adapter: query payment gốc thành công vẫn UNKNOWN rồi NEEDS_MANUAL. Nhánh đối soát thành công được kiểm chứng bằng mock receipt bền vững, không phải bằng chứng E2E VNPay. Worker chết sau dấu gửi phục hồi theo đường đối soát, không lặp refund. Xem ADR-0020 và test `refund.conc-spec.ts` (kill process thật giữa 500 payment).
