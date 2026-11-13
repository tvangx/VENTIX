# Sequence domain Sơn — S-603

Baseline và source/test trong [SRS/UC](../specs/son-domain-srs-uc.md). Mỗi transaction dùng DB service sở hữu. Outbox relay chạy sau commit và có thể giao lại, Inbox chặn trùng.

## Identity và KYC

```mermaid
sequenceDiagram
  actor U as User
  participant I as Identity
  participant D as identity_db
  participant R as Redis
  participant M as SMTP
  U->>I: Login email/password
  I->>D: Verify credentials, store refresh hash/family
  I-->>U: Access JWT and refresh cookie
  U->>I: KYC challenge and Idempotency-Key
  I->>D: Read ACTIVE user and account email
  I->>R: Atomic TTL challenge and cooldown
  I->>M: Send OTP to account email
  I-->>U: Challenge receipt
  U->>I: Verify challenge and OTP
  I->>R: Atomic attempt check
  I->>D: Transaction profile, receipt, AuditRecorded Outbox
  D-->>I: Commit
  I->>R: Mark consumed
  I-->>U: Verified status and lookup hash
```

SMTP failure vô hiệu challenge tương ứng, cooldown giữ giới hạn gửi. DB failure rollback profile/receipt/Outbox và cho retry trong TTL. DB receipt giúp replay khi crash sau commit trước Redis consume. Google OAuth state/PKCE và email auth đã merge main, KYC thuộc #85.

## Event publish và phát vé

```mermaid
sequenceDiagram
  actor O as Organizer
  actor A as Admin
  participant E as Event
  participant ED as event_db
  participant K as Kafka
  participant B as Booking
  participant T as Ticket
  participant TD as ticket_db
  O->>E: Submit DRAFT with version/key
  E->>ED: Transaction PENDING and receipt
  A->>E: Approve with version/key
  E->>ED: Transaction APPROVED, approval, receipt
  O->>E: Publish with version/key
  E->>ED: Transaction PUBLISHED, freeze map, EventApproved v2 Outbox
  ED-->>K: Relay event.lifecycle
  K-->>B: Inbox event read-model
  Note over B: Checkout and payment confirmation follow ADR-0009
  B-->>K: OrderConfirmed from Booking Outbox
  K->>T: booking.orders
  T->>TD: Transaction Inbox, issuance, tickets, secrets, TicketIssued Outbox
  TD-->>K: Relay ticket.events
```

Ticket bắt đầu từ OrderConfirmed. Booking xử lý payment success theo state machine trước đó. Unique order item/unit cùng fingerprint bảo vệ business replay, invalidation tombstone bảo vệ refund/cancel tới sớm.

## Check-in online và offline

```mermaid
sequenceDiagram
  actor S as Staff device
  participant T as Ticket
  participant D as ticket_db
  participant K as Kafka
  S->>T: Download package with RSA public key
  T->>D: Check assignment and current ACTIVE secrets
  T-->>S: RSA-OAEP and AES-GCM encrypted TTL package
  S->>T: Enroll offline device matching package key
  T->>D: Device context and encrypted HMAC key
  T-->>S: Wrapped device key and server_time
  alt Online
    S->>T: POST check-ins with QR and key
    T->>D: Lock gate/ticket, verify DB time TOTP
    T->>D: Transaction state, log, receipt, TicketCheckedIn Outbox
  else Offline then reconnect
    Note over S: Verify locally and retain scans during package window
    S->>T: Signed HMAC batch with stable scan IDs
    T->>D: Check assignment, context, timestamp and versions
    T->>D: Transaction locked tickets, logs, batch receipt, Outbox
  end
  T-->>S: Stable receipt and results
  D-->>K: Relay TicketCheckedIn
  S->>T: Sync replay or request revocation delta
  T-->>S: Current revocation delta
```

Nhánh check-in nằm trong #85. Unique index bảo đảm một ACCEPTED mỗi vé. HMAC sai bị từ chối trước ghi, quyền Staff được kiểm tra khi replay. Receipt ổn định, delta được lấy mới. Cửa sổ thu hồi và quét trùng giữa thiết bị offline được mô tả trong ADR-0007.

## Listing và phục hồi

```mermaid
sequenceDiagram
  actor S as Seller
  participant R as Resale
  participant RD as resale_db
  participant T as Ticket
  participant TD as ticket_db
  S->>R: Create listing with JWT/key
  R->>RD: Commit PENDING intent and audit Outbox
  R->>T: Freeze with stable listing ID and service key
  T->>TD: Transaction FROZEN binding/state and audit Outbox
  T-->>R: Owner, event and server price snapshot
  R->>RD: Commit FROZEN intent, validate current cap
  R->>T: Replay freeze to revalidate
  T-->>R: Current binding snapshot
  R->>RD: Commit ACTIVE listing, COMPLETED receipt, ListingCreated Outbox
  R-->>S: Stable receipt
  S->>R: Cancel listing with key
  R->>RD: Commit CANCELLED, release intent, ListingCancelled Outbox
  R->>T: Unfreeze matching binding
  T->>TD: RELEASED tombstone and conditional release
  R->>RD: Commit COMPLETED receipt
```

Lỗi cap/state khi tạo chuyển RELEASING trước unfreeze, rồi FAILED. Lỗi mạng/DB giữ intent cho retry/recovery worker. Binding RELEASED chặn freeze tới muộn. Flow thuộc #85, S-405/S-501 cùng hoàn tiền resale chờ #82.
