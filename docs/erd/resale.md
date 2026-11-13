# Resale — S-304 và S-404

```mermaid
erDiagram
  LISTINGS {
    uuid id PK
    uuid ticket_id "ref ticket_db"
    uuid seller_id "ref identity_db"
    uuid event_id "ref event_db"
    uuid organizer_id "optional snapshot"
    bigint original_price_vnd
    bigint ask_price_vnd
    int max_percent
    text status
    int version
  }
  LISTING_OPERATIONS {
    uuid id PK
    uuid seller_id
    text scope
    uuid request_key
    text fingerprint
    text kind
    text state
    uuid listing_id "stable reference"
    uuid ticket_id
    jsonb response
    text failure_code
    timestamptz next_attempt_at
    int version
  }
  RESALE_TICKET_INVALIDATIONS {
    uuid id PK "ticket reference"
    text status
    int version
  }
  PRICE_CAP_RULES {
    uuid id PK
    uuid event_id
    int max_percent
  }
```

Mỗi bảng có created_at/updated_at theo migration. Unique ACTIVE ticket trong listings, unique seller/scope/request_key và unique ticket đang PENDING/FROZEN/RELEASING trong listing_operations. Các ID ngoài DB giữ dạng reference. Snapshot organizer nullable để hỗ trợ listing S-304 đã có.

Ticket DB giữ ticket_freezes với ID bằng listing ID, FK nội bộ ticket_id, snapshot seller/event/organizer/giá, trạng thái FROZEN/RELEASED và version. Partial unique một binding FROZEN mỗi ticket. Chi tiết phục hồi ở ADR-0016.
