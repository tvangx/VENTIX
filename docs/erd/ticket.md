# Ticket DB — S-402

```mermaid
erDiagram
  ticket_issuances ||--o{ tickets : issues
  tickets ||--o{ ticket_secrets : versions
  ticket_events ||--o{ gates : owns
  gates o|--o{ tickets : assigned
  gates ||--o{ staff_assignments : staffs
  gates ||--o{ checkin_logs : scans
  tickets o|--o{ checkin_logs : identifies
  tickets {
    uuid id PK
    uuid order_id FK
    uuid event_id
    uuid organizer_id
    uuid gate_id FK
    varchar status
    int secret_version
    int version
  }
  ticket_secrets {
    uuid id PK
    uuid ticket_id FK
    int version
    bytea secret_enc
    varchar key_id
    timestamptz revoked_at
  }
  ticket_events {
    uuid id PK
    uuid organizer_id
    boolean cancelled
    int source_version
  }
  gates {
    uuid id PK
    uuid event_id FK
    uuid organizer_id FK
    varchar name
  }
  staff_assignments {
    uuid id PK
    uuid gate_id FK
    uuid event_id FK
    uuid organizer_id FK
    uuid staff_user_id
    timestamptz revoked_at
  }
  checkin_logs {
    uuid id PK
    uuid ticket_id FK
    uuid scanned_ticket_id
    uuid gate_id FK
    uuid event_id FK
    uuid organizer_id FK
    uuid staff_user_id
    varchar result
    boolean offline
    timestamptz scanned_at
  }
```

Composite FK của Gate và Staff giữ event/organizer nhất quán. Ticket có gate_id nullable cho vé chờ phân cổng. Log có ticket_id nullable khi ID được quét chưa tồn tại, scanned_ticket_id giữ ID của request. Index `uq_checkin_accepted` chỉ áp dụng log ACCEPTED theo ticket_id. Log chỉ INSERT, có trigger append-only và quyền SQL hạn chế.

`ticket_requests` lưu actor/scope/key/fingerprint/response cho replay idempotent, unique theo actor/scope/key. `ticket_order_invalidations` giữ tombstone hủy/hoàn theo order. `outbox_events` và `processed_events` phục vụ Outbox/Inbox theo thư viện chung. Các ID order, event, organizer, staff tham chiếu service khác qua ID.
