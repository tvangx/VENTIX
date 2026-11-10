# Finance DB — T-402

Mở rộng ERD 5.9; mô hình chi tiết và kiểu dữ liệu nằm trong `services/finance/prisma/schema.prisma`, CHECK/trigger nằm trong migration. Không có FK/JOIN sang database khác. Không tạo payouts hoặc logic hóa đơn.

```mermaid
erDiagram
  finance_orders ||--|{ ledger_transactions : "order_id (logical)"
  ledger_transactions ||--|{ ledger_entries : txn_id
  finance_orders ||--|{ revenue_records : "order_id (logical)"
  events_ref ||--o{ seat_classes : "event_id (logical)"
  events_ref ||--o{ event_sales_stats : "event_id (logical)"
  events_ref ||--o{ event_revenue_stats : "event_id (logical)"
  dead_letters ||--o| dlq_replays : "dead_letter_id (logical)"
  invoices ||--o{ invoice_items : invoice_id

  ledger_transactions {
    uuid id PK
    uuid order_id "ref booking; unique with kind"
    text kind "SALE REFUND"
    text created_xid "stamped by trigger"
  }
  ledger_entries {
    uuid id PK
    uuid txn_id FK
    text account
    bigint debit_vnd
    bigint credit_vnd
    uuid ref_id "order"
  }
  revenue_records {
    uuid id PK
    uuid order_id "unique with category"
    uuid organizer_id
    uuid event_id
    text category
    bigint gross_vnd
    bigint net_vnd
    decimal vat_rate
    bigint vat_vnd
    jsonb items "includes ticket_class_id snapshot"
    timestamptz reversed_at
  }
  events_ref {
    uuid event_id UK
    uuid organizer_id
    text title
    int event_version
    int seat_map_version
    boolean pricing_ready
    jsonb ticket_classes
  }
  seat_classes {
    uuid event_id "unique with seat_id and seat_map_version"
    uuid seat_id
    uuid ticket_class_id
    int seat_map_version
  }
  finance_orders {
    uuid id PK
    uuid event_id
    uuid payment_id
    text fingerprint
  }
  pending_refunds {
    uuid id PK "refund_id"
    uuid order_id
    uuid payment_id
    bigint amount_vnd
    jsonb message
  }
  audit_logs {
    bigint id PK
    uuid message_id UK
    jsonb record "canonical inputs including SQL fields"
    char prev_hash
    char hash
  }
```

`event_sales_stats` duy nhất `(event_id,ticket_class_id)`; `event_revenue_stats` duy nhất `(event_id,category)`. Dead letters duy nhất `(topic,partition,offset)`, replay duy nhất dead_letter_id. Bảng nghiệp vụ có created_at; bảng thay đổi có updated_at/version. Audit dùng bigint id theo ERD gốc. `outbox_events` và `processed_events` theo thư viện dùng chung.

```mermaid
sequenceDiagram
  participant K as Kafka
  participant F as Finance Inbox
  participant DB as finance_db
  participant R as Outbox relay
  K->>F: OrderConfirmed / RefundCompleted
  F->>DB: BEGIN + processed_events
  F->>DB: advisory lock(order_id)
  F->>DB: ledger + revenue + stats hoặc pending_refund
  opt Refund không khớp
    F->>DB: INSERT outbox AuditRecorded
  end
  F->>DB: COMMIT (deferred balance check)
  F->>K: Commit offset
  R->>DB: Lock unpublished Outbox
  R->>K: Publish acks=all
  R->>DB: Mark published + COMMIT
```
