# ADR-0016 — Freeze vé và phục hồi niêm yết resale

Trạng thái đề xuất, chờ Tuấn review trong S-404. Ngày 2026-11-12.

## Bối cảnh

S-404 yêu cầu freeze đồng bộ idempotent trước khi tạo listing, một listing ACTIVE mỗi vé, hủy và tìm kiếm. Ticket và Resale có DB riêng. HTTP có thể mất phản hồi sau commit, process có thể dừng giữa hai transaction. Giá gốc phải lấy từ Ticket, cap theo rule Resale hiện hành.

## Giao diện và trạng thái

Ticket cung cấp `POST /v1/internal/tickets/:ticketId/freeze` và `/unfreeze`. `X-Internal-Key` theo ADR-0010, so sánh constant-time. Body có `listing_id`, `seller_id`, UUID `Idempotency-Key` bằng listing_id. Response có ID binding/ticket/seller/event/organizer, giá gốc chuỗi VND, `freeze_status` và `ticket_status`.

Ticket khóa hàng vé, xác minh seller, event và trạng thái. Ledger `ticket_freezes` giữ binding FROZEN/RELEASED theo listing ID. Partial unique bảo đảm một binding FROZEN mỗi vé. Freeze cùng binding trả lại snapshot. RELEASED chặn freeze đến muộn. Unfreeze chỉ giải phóng binding trùng, giữ trạng thái terminal và vé thuộc event đã hủy. Ghi ledger/trạng thái và AuditRecorded Outbox cùng transaction.

Resale lưu `listing_operations` theo seller/scope/key và fingerprint trước khi gọi Ticket. UUID listing ID được tạo một lần và giữ qua retry. Request xác thực bằng JWT, intent lưu ID và trace. Worker dùng service key để tiếp tục sau khi phiên caller kết thúc.

- Create đi qua PENDING → FROZEN → COMPLETED. Tại mỗi lần drive, Ticket xác minh lại owner/state/event, Resale đọc lại cap. Tạo listing ACTIVE, ListingCreated, receipt và audit trong transaction cuối.
- Lỗi nghiệp vụ lưu RELEASING cùng mã lỗi trước khi unfreeze. Khi bù hoàn tất, operation sang FAILED và replay trả lỗi đã lưu.
- Cancel ghi CANCELLED, ListingCancelled và intent PENDING cùng transaction trước khi gọi unfreeze. Hoàn tất release thì lưu COMPLETED. Listing SOLD trả 409. Receipt của request giữ ổn định sau các thay đổi tiếp theo của listing.
- Lỗi mạng/DB tạm thời trả `503 LISTING_OPERATION_PENDING`. Caller retry cùng key. Worker có backoff 1–60 giây, batch tối đa 10 intent, được bật riêng với Kafka relay.

Advisory lock theo UUID ticket chuẩn hóa trong Resale, row lock/conditional update và partial unique trong mỗi DB giữ thứ tự thao tác cạnh tranh. Các lỗi ghi Outbox rollback cùng dữ liệu nghiệp vụ.

## Sự kiện và tìm kiếm

Consumer dùng Inbox hiện hành cho TicketRevoked và TicketCheckedIn. Tombstone terminal bền vững chặn create sau tín hiệu đến sớm, hủy listing ACTIVE và ghi ListingCancelled cùng transaction. Tenant được đối chiếu khi đã có snapshot organizer. TicketRevoked reason TRANSFERRED được xử lý trong luồng chuyển quyền S-405.

GET `/v1/listings` dùng JWT theo mặc định service, lọc ACTIVE theo event, khoảng giá và UUID cursor. GET me và quote tiếp tục dùng giao diện S-304. Giá request là số nguyên VND an toàn, response là chuỗi. Hợp đồng Kafka dùng source hiện hành ListingCreated/ListingCancelled.

## Kiểm chứng và vận hành

Kiểm thử HTTP thật giữa Ticket/Resale trên hai PostgreSQL với role service riêng. Proxy kiểm thử bỏ phản hồi sau upstream commit để kiểm tra phục hồi. Các ca Outbox rollback, cap, terminal, duplicate và 50 request cạnh tranh bao phủ state machine. Kafka riêng kiểm tra Inbox/relay/DLQ.

`INTERNAL_API_KEY` cần được cấu hình chung cho hai service. `RESALE_RECOVERY_ENABLED` và `RESALE_WORKERS_ENABLED` mặc định false. Thiếu key chặn create/cancel và chặn bật recovery. Endpoint nội bộ cần được chặn ở gateway theo cấu hình ADR-0010 hiện hành. Retention intent/binding và triển khai production cần được nhóm chốt trước vận hành.
