# SRS và Use Case phạm vi Sơn

Ngày đối chiếu 2026-11-13. Tài liệu này bổ sung đặc tả triển khai cho identity, event, ticket và resale theo S-603. Bộ UC-01..16 gốc được architecture-v2 tham chiếu chưa có trong repo. Các ID SRS-S/UC-S dưới đây phục vụ truy vết trong repo.

## Phiên bản và phạm vi

| Baseline       | Nội dung                                                         | Tình trạng tại lần đối chiếu             |
| -------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| main `0977e9d` | Identity tuần 1, Event tuần 2, phát vé S-301                     | Đã merge #36/#65/#69/#70                 |
| #85 `d4276e7`  | Wallet, thu hồi/chuyển vé, KYC, check-in online/offline, listing | Code đã triển khai, CI xanh, chờ review  |
| #86 `a274865`  | NFT worker, nft_mints, MockMinter                                | CI xanh, chờ review                      |
| #87 `d1fd1a5`  | Cổng public verify                                               | CI xanh, base #86, chờ review            |
| #88 `d5e16aa`  | Invoice MockAdapter trong Finance                                | PR độc lập, xem CI hiện hành trên GitHub |
| #82            | Refund resale, cần cho S-405/S-501                               | Hợp đồng đang chờ chốt                   |

Các baseline là nhánh riêng. Khi review hãy mở source đúng SHA trong bảng, đặc biệt phần Ticket của #85 và NFT của #86 chưa cùng một nhánh tích hợp. Đường dẫn endpoint là trực tiếp service với prefix `/v1`. Gateway và UI có vòng kiểm chứng riêng.

## Yêu cầu và tiêu chí chấp nhận

| ID       | Yêu cầu                                                             | Tiêu chí chấp nhận và nguồn                                                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SRS-S-01 | USER đăng ký, đăng nhập email hoặc Google, refresh/logout           | JWT RS256/JWKS, cookie refresh HttpOnly, phát hiện reuse theo family. Main `services/identity/test/integration/auth.int-spec.ts`, `google.int-spec.ts`, `test/concurrency/refresh.conc-spec.ts`                                                                                  |
| SRS-S-02 | ADMIN duyệt hồ sơ Organizer, quyền theo tenant                      | Tài nguyên thuộc organizer claim, duyệt có version, upload private bucket và URL tải có hạn. Main `services/identity/test/integration/organizers.int-spec.ts`, `access.int-spec.ts`                                                                                              |
| SRS-S-03 | USER xác minh KYC bằng OTP email tài khoản                          | Ciphertext AES-GCM với key_id, HMAC unique CCCD, TTL/cooldown/giới hạn thử atomic Redis, profile và audit Outbox cùng transaction. #85 `services/identity/test/integration/kyc.int-spec.ts`, `kyc-relay.int-spec.ts`, `test/concurrency/kyc.conc-spec.ts`                        |
| SRS-S-04 | Organizer quản lý event/venue/seat map, Admin duyệt trước công khai | Publish khóa phiên bản map và phát EventApproved v2 cùng transaction. Catalog chỉ PUBLISHED, event hủy ngừng xuất hiện. Main `services/event/test/integration/event-lifecycle.int-spec.ts`, `public-catalog.int-spec.ts`, `seat-map.int-spec.ts`                                 |
| SRS-S-05 | Phát vé từ OrderConfirmed                                           | Mỗi đơn vị item vé có một ticket và secret, message/business replay an toàn, lỗi rollback cả Inbox/Outbox. Main `services/ticket/test/integration/issuance.int-spec.ts`                                                                                                          |
| SRS-S-06 | Owner lấy ví vé và QR động                                          | GET tickets chỉ vé owner, token chỉ ACTIVE và secret hiện hành, cache private no-store. #85 `services/ticket/test/integration/wallet.int-spec.ts`                                                                                                                                |
| SRS-S-07 | Staff check-in đúng event/cổng/phân công                            | TOTP SHA1, 6 số, bước 30 giây, cửa sổ ±1. Một ACCEPTED/ticket, append-only log, TicketCheckedIn Outbox cùng transaction. #85 `services/ticket/test/integration/checkin.int-spec.ts`, `test/concurrency/checkin.conc-spec.ts`                                                     |
| SRS-S-08 | Staff tải verification package và sync offline                      | Gói đúng event/cổng, TTL, RSA-OAEP/AES-GCM. Batch HMAC, timestamp trong cửa sổ, quyền hiện hành và chống replay. #85 `services/ticket/test/integration/gates.int-spec.ts`, `offline.int-spec.ts`, `test/concurrency/offline.conc-spec.ts`                                        |
| SRS-S-09 | Seller niêm yết/hủy vé với trần giá server                          | Freeze trước ACTIVE listing, intent durable phục hồi mất response, một listing ACTIVE/vé, unfreeze đúng binding khi hủy. #85 `services/resale/test/integration/listing-operations.int-spec.ts`, `listing-worker.int-spec.ts`, `test/concurrency/listing-operations.conc-spec.ts` |
| SRS-S-10 | Thu hồi/chuyển quyền cập nhật secret                                | Đổi owner tăng secret_version, thu hồi secret cũ và delta cho Staff. #85 `services/ticket/test/integration/revocation.int-spec.ts`                                                                                                                                               |
| SRS-S-11 | Mint NFT bất đồng bộ và public verify                               | Mint lỗi vẫn giữ vé off-chain. MOCK có mock_reference, tx_hash NULL. Public chỉ projection ticket/status/NFT, rate limit, escape HTML. #86/#87 `services/ticket/test/integration/nft.int-spec.ts`, `verify.int-spec.ts`                                                          |

Tiền là VND nguyên, ID là UUID và timestamp UTC. Mỗi service chỉ truy cập DB của mình. Producer dùng Outbox cùng transaction, consumer dùng Inbox. Các cam kết hiệu năng của architecture là mục tiêu cần đo trên môi trường nghiệm thu.

## Use Case

### UC-S-01 — Phiên đăng nhập và hồ sơ Organizer

USER đăng ký bằng email/password với Idempotency-Key, đăng nhập để nhận JWT và refresh cookie. Google dùng flow PKCE/state. Refresh đổi token và ghi nhận family. Logout thu hồi family. ADMIN duyệt hồ sơ PENDING với version hiện hành để cấp scope ORGANIZER trong transaction.

Email trùng, key cùng nội dung khác, credential sai, state hết hạn hoặc token bị reuse trả lỗi theo OpenAPI Identity. Scope Organizer thứ hai xung đột phải được xử lý theo quy trình quản trị. Access JWT đã phát có TTL riêng sau logout. Xem [API Identity](../api/identity/README.md).

### UC-S-02 — KYC qua email

Tiền điều kiện là user ACTIVE có email tài khoản. USER tạo challenge, Identity gửi OTP qua SMTP tới email đọc từ DB. Verify dùng challenge và key idempotency, đối chiếu OTP với payload đã mã hóa, tạo profile và audit Outbox. Kết quả trả verified/hash lookup, dữ liệu KYC được giữ trong Identity.

Sai OTP, hết TTL, cooldown, SMTP lỗi, đổi email và CCCD đã liên kết đều có nhánh lỗi riêng. Transaction DB thất bại cho phép retry OTP trong TTL. Đây là xác minh kênh email cùng thông tin tự khai, tích hợp eKYC giấy tờ vẫn cần đặc tả. Source #85 `services/identity/src/modules/kyc/`.

### UC-S-03 — Duyệt và công khai sự kiện

ORGANIZER tạo DRAFT, venue cùng tenant, hạng vé, sale phase và seat map nếu SEATED. Submit chuyển PENDING, ADMIN approve/reject với version. Organizer publish APPROVED khi cấu hình đủ, đóng băng map và ghi EventApproved v2. Catalog trả PUBLISHED với ETag. Cancel sau publish phát EventCancelled, các consumer xử lý theo read-model riêng.

Version cũ, sai tenant, map thiếu hoặc trạng thái sai bị từ chối. Map đã publish bất biến. Lifecycle phát sự kiện ở thời điểm publish theo ADR-0013, tên EventApproved thuộc hợp đồng hiện hành. Xem [ERD Event](../erd/event.md).

### UC-S-04 — Phát vé và check-in

Booking đã commit order xác nhận và phát OrderConfirmed. Ticket Inbox tạo vé/secret và TicketIssued. Owner lấy wallet/token. Organizer gắn vé với cổng, phân công Staff. Staff gửi QR, gate/event và Idempotency-Key. Server xác minh quyền hiện hành, TOTP theo giờ DB, khóa vé và ghi ACCEPTED cùng state CHECKED_IN, log, receipt và Outbox.

Replay cùng key trả receipt ổn định sau kiểm tra quyền. Quét vé đã check-in trả DUPLICATE. Sai TOTP/version/trạng thái trả INVALID, sai event/cổng có kết quả riêng. Secret thiếu/hỏng trả lỗi phục hồi, không tạo ACCEPTED. Source #85 `services/ticket/src/modules/checkin/`.

### UC-S-05 — Check-in offline và đối soát

Staff đã có assignment, gói xác thực còn hạn và device session. Client giải mã package, kiểm tra TOTP tại cổng và lưu scan. Khi có mạng, gửi batch HMAC với batch_id bằng Idempotency-Key. Server đối chiếu context, timestamp, chữ ký, quyền hiện hành, secret version và state, rồi commit logs/state/batch receipt/Outbox. Response gồm receipt cùng delta thu hồi hiện hành.

Hai thiết bị có thể cho cùng vé qua cổng lúc offline. Server chỉ ghi một ACCEPTED khi sync, các lần sau DUPLICATE. HMAC sai bị từ chối trước ghi dữ liệu. Timestamp scan phải trong thời hạn package, upload lịch sử có thể tới sau hạn. Client PIN/IndexedDB và bằng chứng thiết bị thật thuộc kiểm chứng PWA phối hợp Vũ. Xem [ADR offline](../adr/0007-offline-checkin-plan-a.md).

### UC-S-06 — Niêm yết và hủy resale

Seller có vé ACTIVE và gửi giá đề nghị với key. Resale commit intent, gọi Ticket freeze bằng service key/listing ID ổn định. Ticket xác minh owner/state, trả giá gốc snapshot. Resale kiểm tra cap rồi commit ACTIVE listing/receipt/ListingCreated. Cancel commit CANCELLED và ListingCancelled trước khi release binding.

Lỗi response/DB được tiếp tục bằng cùng key hoặc recovery worker. Vi phạm cap/trạng thái đi qua RELEASING và bù unfreeze. SOLD chặn cancel. Thanh toán mua lại, escrow và giải ngân đang chờ S-405/S-501 cùng hợp đồng #82. Xem [sequence snapshot](../sequence/son-domain-s603.md).

### UC-S-07 — Mint và tra cứu

TicketIssued tạo job NFT qua Inbox. Worker claim job, gọi minter bằng ticket key, retry có lease/version fencing. Public API và trang verify chỉ đọc projection hiện hành. MOCK được hiển thị rõ, vé off-chain giữ hiệu lực độc lập với mint. Tra cứu UUID sai trả 400, vé thiếu 404, vượt hạn mức 429. Source #86/#87 `services/ticket/src/modules/nft/` và `verify/`.

## Truy vết và nghiệm thu còn lại

[ERD snapshot](../erd/son-domain-s603.md) và [sequence snapshot](../sequence/son-domain-s603.md) ghi ranh giới DB/transaction. Test path trong bảng là nguồn kịch bản ở revision tương ứng, kết quả chạy nằm trong run report từng PR. S-601 chờ G3 và bộ E2E chung, S-504 chờ S-305/#85, tập dượt S-604 cần môi trường và người tham gia. Run report [S-603](../agent/runs/S-603.md) ghi kiểm chứng tài liệu lần này.
