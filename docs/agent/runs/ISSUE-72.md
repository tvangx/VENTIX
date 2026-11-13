# Run report — Issue #72 TicketRevoked reasons

- Ngày 2026-11-12. Nhánh `feat/contracts-issue72-ticket-revoked-v2` từ S-302. PR hợp đồng riêng, xếp sau #71 và trước #73.
- Người dùng yêu cầu tiếp tục triển khai theo issue #72, Tuấn review sau. Phạm vi ủy quyền gồm hợp đồng reason và triển khai S-303 liên quan. Review/merge main vẫn theo bảo vệ GitHub.

## Kế hoạch trước code

- Giữ TicketRevoked v1 và thêm v2 có năm reason USER_CANCELLED, EXPIRED, LATE_PAYMENT, STOCK_REJECTED, PAYMENT_FAILED bên cạnh reason cũ. Registry đọc cả hai version theo mẫu lifecycle đang có.
- Test v1 cũ, v1 từ chối reason mới, v2 nhận reason mới, version/reason lạ bị từ chối. Không thêm dependency hoặc topic.
- README hợp đồng ghi thứ tự rollout consumer trước producer. Ticket S-303 chỉ dùng v2 cho năm reason mới để giữ message hiện hành khi reason đã có trong v1.
- Rà source consumer hiện có, chạy contract lint/typecheck/test/build và build toàn repo. Cập nhật issue/PR để Tuấn review lựa chọn version và rollout.
- Giả định triển khai cần review là chọn version 2 để parser v1 giữ nguyên tập giá trị. Consumer cũ phải được cập nhật trước khi producer phát v2. Không triển khai ra môi trường thật trong lượt này.

## Kết quả

- Contract tests 29/29 pass, gồm 10 test version/reason mới. Lint/typecheck pass.
- Rà source hiện tại cho thấy consumer nghiệp vụ TicketRevoked chưa có trong notification/finance/resale. Các consumer tương lai và thư viện Inbox parse chung phải nhận bản schema mới trước producer v2.
- Lượt build đầu dùng pnpm cache trực tiếp nhưng Turbo gọi shim pnpm hệ thống khác version, dừng ở ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. Chạy lại qua npm exec offline pnpm 9.15.9 để đồng bộ PATH, không thay lockfile hoặc giảm kiểm tra.
- Self-review giữ nguyên schema v1, thêm union v1/v2 theo mẫu lifecycle hiện hành và test từ chối reason/version lạ. Tuấn review version/rollout trong PR hợp đồng.
