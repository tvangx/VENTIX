# Payment DB — bổ sung T-401

```mermaid
erDiagram
  payments ||--o| refunds : "UNIQUE payment_id, full refund"
  refund_batches o|--o{ refunds : batch_id
  payments ||--o{ payment_transactions : payment_id
  refund_events {
    uuid id PK "ref event-service event; no cross-DB FK"
    uuid organizer_id
    int event_version
    boolean cancelled
    int version
  }
  refunds {
    uuid id PK
    uuid payment_id UK
    uuid batch_id FK
    bigint amount_vnd
    string status "PENDING PROCESSING SUCCEEDED NEEDS_MANUAL"
    int attempts
    timestamptz next_attempt_at
    timestamptz sent_at "durable delivery marker"
    uuid claim_token
    timestamptz lease_until
    string trace_id
    string provider_refund_id
    int version
  }
  refund_batches {
    uuid id PK
    uuid event_id
    boolean automatic "partial UNIQUE event_id when true"
    string reason
    uuid created_by
    int version
  }
  refund_dispatch {
    uuid id PK "singleton seeded by migration"
    timestamptz next_at
    int version
  }
  refund_requests {
    uuid id PK
    string key UK
    string request_hash
    jsonb response
  }
  mock_refund_receipts {
    uuid id PK "stable refund ID, mock provider receipt"
    uuid payment_id UK
    bigint amount_vnd
  }
```

Mọi bảng có created_at; bảng cập nhật có updated_at/version. Outbox/Inbox hiện có tiếp tục dùng cho RefundCompleted/AuditRecorded và consumer. Claim CHECK bắt buộc PROCESSING có token/lease/sent_at; trạng thái khác không giữ claim. Quota khóa refund_dispatch, không khóa DB qua HTTP. Batch progress tính từ refunds, không dựa vào status cache hoặc counter. Không có FK/JOIN tới DB service khác; mock receipt là ledger mô phỏng provider trong payment_db, không phải dữ liệu provider thật.
