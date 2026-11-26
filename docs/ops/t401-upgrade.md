# Nâng cấp T-401 từ bản T-208 (#111)

Đây là hướng dẫn cho Tuấn sau review/merge, không phải biên bản đã triển khai. Theo chỉ đạo tiếp theo, Tuấn sẽ hoàn tất task observability trước khi đóng gói và deploy; T-401 chỉ chuẩn bị hướng dẫn này, không tạo bundle hay tự bắt đầu task observability. Task không truy cập EC2, không nhận secret, không chạy thanh toán hoặc hoàn tiền thật. Refund VNPay vẫn mặc định tắt.

## Thay đổi dữ liệu và cấu hình

- Payment migration mới: `20261126020452_refund_worker`. Bổ sung automatic cho refund_batches; claim_token, lease_until, sent_at, trace_id cho refunds; tạo refund_events (tenant/lifecycle read-model), refund_dispatch (quota chung), refund_requests (idempotency Admin), mock_refund_receipts (provider giả bền vững). Giữ UNIQUE(payment_id), thêm index và CHECK. Không sửa migration cũ, không DROP/reset/truncate hoặc đổi payment/vé/khóa hiện có.
- Booking không có migration mới. Thay lifecycle consumer và thêm consumer cancellation replay; schema/máy trạng thái giữ nguyên ADR-0009.
- Env mới trong `services/payment/.env.example` và overlay/demo example: VNPAY_REFUND_ENABLED=false, VNPAY_REFUND_URL=https://sandbox.vnpayment.vn/merchant_webapi/api/transaction, VNPAY_REFUND_IP=127.0.0.1, VNPAY_REFUND_TIMEOUT_MS=10000, REFUND_CONCURRENCY=5, REFUND_RATE_PER_SEC=5, REFUND_MAX_ATTEMPTS=5, REFUND_LEASE_MS=30000, REFUND_BACKOFF_MS=1000, REFUND_BACKOFF_MAX_MS=60000.
- MOCK_REFUND_FAILURE_RATE=0 và MOCK_REFUND_OUTCOME=SUCCESS dành cho local/mock. Không cần thêm credential mới. Mọi replica phải cùng quota; lease lớn hơn HTTP timeout.
- Không thay VNPAY_PAYMENT_URL hiện đã thử, merchant secret, INTERNAL_API_KEY, ADMISSION_TOKEN_SECRET, JWT signing key, TICKET_ACTIVE_KEY_ID/TICKET_ENCRYPTION_KEYS, DB password hoặc Cloudflare token. Không chép file example đè env thật.

## Đóng gói local

Sau task observability, khi commit phát hành đã được review và working tree sạch, tại repo Windows:

```powershell
powershell -NoProfile -File infra/deploy/package-demo.ps1 -Release t401-<commit-ngan>
```

Dùng release mới, không tái dùng tag T-208. Script hiện có build/save bộ image linux/amd64, migration, compose/scripts và SOURCE_COMMIT/IMAGES/SHA256SUMS vào `dist/demo/<release>.tar` cùng checksum. Bundle không mang env/secret thật. Bộ image gồm cả các service T-208 để tái dùng đúng quy trình, dù thay đổi runtime chỉ ở payment và booking. Không thay image hạ tầng. Kiểm tra artifact và digest trước khi Tuấn chuyển thủ công lên máy chủ. Task này chưa thực hiện đóng gói image release hay upload.

## Trình tự Tuấn thực hiện trên EC2

1. Backup DB/volume theo quy trình hiện có, ghi release T-208 đang dùng để rollback. Giữ nguyên project `ticketing-prod`, volume, mạng, đường dẫn env/token và các khóa bền vững. Kiểm kê refund cũ/PROCESSING bất thường nếu có; migration không tự xóa dấu trạng thái tài chính để cho phép gửi lại.
2. Xác minh checksum, giải nén release mới riêng thư mục cũ. Chỉ bổ sung các env mới vào app env ngoài repo; giữ `VNPAY_REFUND_ENABLED=false`. Không tự đổi hostname theo payment endpoint đã thử.
3. Chạy `bash infra/deploy/demo.sh check <infra-env-tuyet-doi> <app-env-tuyet-doi> <token-file-tuyet-doi>`. Lệnh validate image/config, chưa migrate hoặc đổi daemon.
4. Khi sẵn sàng cửa sổ nâng cấp, dùng `bash infra/deploy/demo.sh upgrade <infra-env> <app-env> <token-file>`. Quy trình T-208 chạy Kafka topic bootstrap và các migration job tuần tự (`prisma migrate deploy`) trước app/gateway; không reset hoặc seed. Nếu migration lỗi thì dừng, không sửa migration cũ. Dữ liệu booking/ticket và khóa mã hóa được giữ nguyên.
5. Kiểm tra readiness, lag/DLQ và các group `payment-refunds`, `booking-event-cancel-orders-t401`. Refund consumer mới replay lịch sử còn trong Kafka; booking replay hủy các order chưa hoàn tất mà lifecycle cũ đã đánh dấu. Với dữ liệu hủy đã vượt retention, cần lập kế hoạch backfill sự kiện/snapshot được chủ service xác nhận; không tự đọc DB service khác hoặc sinh message đoán dữ liệu.
6. Kiểm tra API Admin với JWT/Idempotency-Key; đối chiếu tiến độ trong DB/API với log correlation và refunds_total. Các refund VNPay vẫn chờ PENDING khi provider tắt. Mock dùng dữ liệu giả nếu cần diễn tập; không dùng payment thật cho smoke test.
7. Trước khi Tuấn bật refund sandbox, xác minh endpoint JSON và quyền merchant với VNPay, IP server/allowlist, code/status và response HMAC thực tế. Payment qua browser thành công không chứng minh các điều này. Chỉ Tuấn tự chạy sandbox có kiểm soát, ghi kết quả thật. Khi kết quả không rõ, không xóa sent_at hoặc reset refund để gửi lại; manual retry chỉ đối soát. Query payment gốc thành công không chứng minh refund đã hoàn tất.

Rollback chỉ image/config tới bản đã chứng minh tương thích, giữ migration bổ sung và dữ liệu. T-208 không có refund worker: rollback sẽ dừng xử lý refund, không đảo tác động đã xảy ra bên provider. Không down -v/reset/migrate reset hoặc thay khóa. Không tuyên bố E2E refund VNPay đạt trước khi Tuấn kiểm chứng thực tế.
