# Niêm yết và hủy vé resale — S-404

```mermaid
sequenceDiagram
  participant U as Seller
  participant R as Resale
  participant RD as resale_db
  participant T as Ticket
  participant TD as ticket_db
  participant K as Kafka
  U->>R: POST listings + JWT + Idempotency-Key
  R->>RD: Commit PENDING intent + Audit Outbox
  R->>T: freeze(listing_id, seller_id) + service key
  T->>TD: Lock ticket, FROZEN binding/state + Audit Outbox
  T-->>R: Snapshot server price/event/owner
  R->>RD: Validate cap, commit FROZEN intent
  R->>T: Replay freeze and revalidate
  T-->>R: Current valid binding
  R->>RD: Listing ACTIVE + COMPLETED receipt + ListingCreated Outbox
  R-->>U: 201 stable receipt
  RD-->>K: Outbox relay ListingCreated
  U->>R: Cancel listing + same seller + request key
  R->>RD: Listing CANCELLED + PENDING intent + ListingCancelled Outbox
  R->>T: unfreeze matching listing_id
  T->>TD: RELEASED tombstone, conditional FROZEN to ACTIVE
  T-->>R: Released binding
  R->>RD: COMPLETED receipt + Audit Outbox
  R-->>U: 200 stable receipt
```

Khi phản hồi HTTP mất hoặc DB lỗi, intent đã commit giữ phase hiện hành. Retry cùng key hoặc recovery worker tiếp tục bằng listing ID cũ. Khi cap hoặc trạng thái không hợp lệ, Resale commit RELEASING trước khi bù unfreeze và lưu FAILED sau khi bù thành công. ListingCancelled luôn commit trước release. Các trạng thái terminal ở Ticket được giữ khi release.
