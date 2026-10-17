---
description: Làm một task theo Task Run Protocol. Cách dùng - gõ /task T-202
---

# /task <ID>

Người dùng gõ `/task T-xxx`. Làm đúng các bước sau, không bỏ bước nào.

1. Lấy ID task từ tin nhắn. Không có ID thì hỏi lại một lần.
2. Đọc theo thứ tự: `AGENTS.md`, `docs/agent/CONVENTIONS.md`, `docs/agent/TUAN_PLAN.md` (mục 3 và đặc tả của task), `docs/agent/STATUS.md`.
3. Mở `docs/agent/PROMPTS.md`, tìm khối prompt của task (tiêu đề `## T-xxx ...`). Coi nội dung khối đó là **yêu cầu của người dùng cho lần chạy này**: nhánh, phụ thuộc, mục tiêu, việc cần làm, kiểm chứng, ràng buộc.
4. Chạy **Task Run Protocol** (`AGENTS.md` mục 2), từ Bước 0 đến Bước 8.
5. **Cổng 1:** bản kế hoạch (Implementation Plan) chính là bản tóm tắt tối đa 10 dòng: hiểu task thế nào, phụ thuộc đã Done chưa, file sẽ tạo/sửa, rủi ro, giả định. Đồng thời ghi vào `docs/agent/runs/<ID>.md` mục Kế hoạch. Sau đó **DỪNG và chờ người dùng nói "OK"**. Không viết code trước khi có OK.
6. Sau OK mới làm. Chạy kiểm chứng thật, ghi kết quả thật vào run report. Không chạy được thì ghi "chưa chạy" và nêu lý do.
7. Kết thúc bằng báo cáo theo `AGENTS.md` mục 10 rồi **DỪNG**. Không tự làm task kế tiếp.

Không được: push vào `main`, tự merge, commit secret hoặc `.env`, chạm DB của service khác, đổi hợp đồng đã chốt, làm yếu test để cho qua.
