# S-502 — Mint bất đồng bộ trong ticket-service

1. S-301 commit vé + secret + Outbox TicketIssued cùng transaction với Inbox OrderConfirmed.
2. Relay phát TicketIssued v1 tới `ticket.events`, key ticket_id. Consumer `ticket-nft-v1` validate bằng contract hiện hành; chỉ ghi `nft_mints` và Inbox trong một transaction.
3. `uq_nft_ticket` giới hạn một job mỗi vé. Fingerprint dữ liệu nguồn phát hiện business replay khác nội dung; message ID/trace không làm thay đổi fingerprint. Payload sai hoặc vé không khớp đưa DLQ qua thư viện Inbox.
4. Worker claim một job bằng `FOR UPDATE SKIP LOCKED`, tăng attempts/version, lưu lease theo đồng hồ PostgreSQL, rồi commit trước khi gọi minter.
5. MockMinter nhận stable key `ticket:<uuid>`, metadata gồm name/ticket_id/event_id. Kết quả xác định và tái tạo được qua process restart; không gọi mạng, không dùng ví/secret.
6. Hoàn tất chỉ khi status MINTING, version còn đúng và lease còn hạn. Worker cũ không thể ghi đè lease mới. Timeout/lỗi provider lưu mã cố định MINT_FAILED; retry exponential backoff với jitter trong nửa trên của khoảng và tối đa 5 attempts mặc định.
7. Crash để lại lease; replica khác reclaim khi lease hết hạn. Nếu hết attempts thì FAILED/LEASE_EXPIRED. Tác vụ FAILED cần điều tra trước khi operator quyết định replay; không có endpoint reset tự động.

Worker NFT không cập nhật tickets/ticket_secrets hoặc phát sự kiện Kafka mới. Bảng job nội bộ không là nguồn xác thực vé. MINTED với provider MOCK không chứng minh quyền sở hữu on-chain hoặc trạng thái check-in hiện tại.

## Dữ liệu

`nft_mints` thuộc ticket_db; FK nội bộ ticket_id tới tickets, unique ticket_id, event_id là ref:event_db (không FK chéo DB).

| Nhóm            | Cột                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------- |
| Nguồn           | id, ticket_id, event_id, fingerprint, source_message_id, trace_id                           |
| Queue           | status PENDING/MINTING/MINTED/FAILED, attempts, next_attempt_at, lease_until, last_error    |
| Kết quả         | provider MOCK, token_id, tx_hash NULL, metadata_uri `mock://...`, mock_reference `mock:...` |
| Đồng thời/audit | version, created_at, updated_at                                                             |

Partial index phục vụ PENDING theo next_attempt_at và MINTING theo lease_until. CHECK bảo vệ status/lease, attempts/version và kết quả mock. Không sửa migration cũ. `tx_hash` giữ NULL trong mock để S-503 không hiển thị một transaction blockchain giả.

## Timebox testnet

Đánh giá điều kiện ngày 2026-11-12 trong timebox tối đa 2 ngày. Bàn giao không có ví testnet, POL faucet, Pinata JWT, contract address, quyết định ví nhận NFT hoặc quyền deploy ngoài local. TicketIssued hiện có owner_user_id nhưng không có wallet address. Không tự thêm trường vào hợp đồng hoặc chọn ví custody.

- [OpenZeppelin ERC-721](https://docs.openzeppelin.com/contracts/5.x/erc721): có ERC721URIStorage và cơ chế access control cần bổ sung cho minter. Adapter thật cần token ID ổn định theo ticket và kiểm tra token đã tồn tại trước retry.
- [Polygon Amoy](https://support.polygon.technology/support/solutions/articles/82000907114-how-to-add-amoy-network-in-your-wallet-): chain ID 80002, native token POL. Cần RPC và ví được cấp gas, xác nhận chain khi khởi động.
- [Pinata upload](https://docs.pinata.cloud/files/uploading-files): upload qua multipart với Bearer JWT. Chỉ đưa metadata đã allowlist lên public IPFS; không publish owner/CCCD/QR/secret.
- [Hardhat](https://hardhat.org/docs/getting-started): nhánh Hardhat hiện hành cần đánh giá tương thích toolchain Node 20/CommonJS của repo trước khi thêm dependency; không cài toolchain vào service chỉ để tạo scaffold chưa kiểm chứng.

Chọn MockMinter theo fallback của plan và chỉ dẫn user khi thiếu điều kiện testnet, không cần chờ đủ hai ngày. Không triển khai Solidity/Pinata adapter nửa vời; phần on-chain thực tế chưa chạy. Trước khi bổ sung phải chốt wallet/custody, quyền mint/transfer, idempotency on-chain, receipt/reorg/reconciliation và migration provider/result. Không suy từ mock rằng retry RPC có tính exactly-once.
