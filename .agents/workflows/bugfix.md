---
description: Sửa một lỗi theo quy trình test đỏ trước. Cách dùng - gõ /bugfix rồi mô tả lỗi
---

# /bugfix <mô tả lỗi>

1. Đọc `AGENTS.md` và `docs/agent/CONVENTIONS.md`.
2. Tái hiện lỗi và mô tả **nguyên nhân gốc**. Chưa sửa.
3. Viết một test **ĐỎ** tái hiện lỗi.
4. Sửa tối thiểu. Chạy lại test mới và toàn bộ test của package.
5. Nếu lỗi do hiểu sai đặc tả hoặc hợp đồng thì **DỪNG và hỏi**.
6. Nhánh `fix/<scope>-<mô-tả>`. Một lỗi một nhánh một PR. Không refactor ngoài phạm vi, không sửa file ngoài vùng sở hữu.
7. Báo cáo theo `AGENTS.md` mục 10 rồi dừng.
