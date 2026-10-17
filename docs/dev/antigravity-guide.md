# Dùng agent hiệu quả trong Google Antigravity (model Claude Sonnet)

> Cập nhật theo tài liệu Antigravity tại thời điểm soạn. Giao diện và tên thư mục có thể đổi giữa các phiên bản; mục nào đánh dấu **(kiểm tra)** thì hãy xác nhận trên máy bạn.
> Nguồn: https://antigravity.google/docs/rules-workflows · https://antigravity.google/docs/skills · https://antigravity.google/docs/artifact-review

## 1. Trả lời nhanh

| Câu hỏi                        | Trả lời                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Có cần cài skill ngoài không?  | **Không.** Không cần bộ "skill pack" của bên thứ ba (bộ có hàng trăm skill làm loãng ngữ cảnh và xung đột với quy ước của dự án).                                                    |
| Có cần tự tạo skill không?     | **Chưa cần để bắt đầu.** Repo đã có sẵn 1 skill nhỏ (`core-code-review`). Chỉ tạo thêm khi bạn thấy mình lặp lại một quy trình ≥ 3 lần (mục 7).                                      |
| `AGENTS.md` có được đọc không? | Antigravity đọc `AGENTS.md` ở gốc workspace (hỗ trợ từ các bản gần đây) và vẫn đọc `GEMINI.md`. Repo có cả hai (`GEMINI.md` chỉ là con trỏ sang `AGENTS.md`). Kiểm tra bằng mục 3.5. |
| Việc cần chỉnh?                | (1) giữ file quy tắc dưới **12.000 ký tự** (đã xử lý, mục 2); (2) cài workflow `/task`; (3) chỉnh chính sách Review/Terminal; (4) chọn model đúng việc.                              |

## 2. Giới hạn 12.000 ký tự và cách repo xử lý

Antigravity giới hạn mỗi file rule/workflow khoảng **12.000 ký tự**; vượt quá thì phần cuối có thể bị cắt, và phần cuối của file cũ chính là điều kiện dừng và mẫu báo cáo. Vì vậy:

- `AGENTS.md` được rút còn khoảng 10.000 ký tự: 10 luật, bối cảnh, Task Run Protocol, điều kiện dừng, mẫu báo cáo.
- Quy ước chi tiết (code, DB, Kafka, Redis, test) chuyển sang `docs/agent/CONVENTIONS.md`. Bước 0 của protocol **bắt buộc agent đọc file này** bằng công cụ đọc file (không bị giới hạn).
- Mỗi workflow/skill đều ngắn hơn nhiều so với giới hạn.

## 3. Thiết lập một lần (10–15 phút)

1. **Cập nhật Antigravity** lên bản mới nhất.
2. **Mở đúng thư mục repo** làm workspace (thư mục gốc có `AGENTS.md`).
3. **Settings → Agent:**
   - **Artifact Review Policy = Request Review.** Ở Planning Mode, agent dừng lại để bạn duyệt kế hoạch trước khi sửa code. Đây chính là **Cổng 1** của quy trình.
   - **Terminal Execution Policy:** tuần đầu dùng chế độ hỏi duyệt từng lệnh. Khi đã tin tưởng (sau T-103), chuyển sang chế độ tự chạy **kèm Deny List**: `git push`, `git reset --hard`, `rm -rf`, `docker volume rm`, `docker compose down -v`, `make reset`, `DROP`, `DELETE FROM`, `TRUNCATE`.
4. **Workflows:** gõ `/` trong khung chat, phải thấy `task`, `review`, `bugfix`. Nếu **không** thấy **(kiểm tra)**: mở panel **Workflows → + Workspace**, tạo workflow cùng tên và dán nội dung từ `.agents/workflows/*.md`.
5. **Kiểm tra agent có đọc quy tắc (smoke test),** trong cuộc trò chuyện mới:
   ```text
   Không làm gì khác, chỉ trả lời từ quy tắc bạn đang áp dụng: (1) liệt kê 10 luật, (2) "chế độ lô" nghĩa là gì và khi nào dùng,
   (3) bạn phải đọc file nào trước khi viết code của một task, (4) mẫu báo cáo cuối task gồm những mục nào.
   ```
   Câu (2) và (4) nằm ở **cuối** `AGENTS.md`: trả lời đúng nghĩa là file không bị cắt. Câu (3) phải nhắc `docs/agent/CONVENTIONS.md`. Sai thì kiểm tra panel **Rules** xem file có xuất hiện không; không có thì tạo rule workspace trỏ tới `AGENTS.md`.

## 4. Chọn model cho đúng việc

| Việc                                                                    | Model gợi ý                           | Lý do                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| Mã lõi: Lua, outbox/inbox, saga, state machine, migration SQL, mã hóa   | **Claude Sonnet** + Planning Mode     | Cần suy luận cẩn thận về đồng thời và trường hợp biên                      |
| Việc khuôn mẫu: CRUD, DTO, script, cấu hình compose, viết test theo mẫu | Claude Sonnet hoặc Gemini + Fast Mode | Đủ nhanh, ít rủi ro                                                        |
| Review chéo (`/review`)                                                 | **Model khác với model đã viết code** | Hai model có điểm mù khác nhau; reviewer cùng model dễ đồng ý với chính nó |
| Tài liệu cuối (T-603), đọc log/báo cáo dài, so sánh nhiều file          | Gemini (ngữ cảnh dài)                 | Đọc rộng, tổng hợp                                                         |
| Giải thích code, hỏi đáp "hội đồng"                                     | Bất kỳ                                | Chủ yếu để học                                                             |

Hạn mức của gói bạn dùng có thể giới hạn số lượt với từng model: tiết kiệm bằng cách chỉ dùng Planning Mode cho task mã lõi, mỗi task một cuộc trò chuyện, và không để agent đọc cả repo.

## 5. Quy trình mỗi task trong Antigravity

| Bước (AGENTS.md) | Trong Antigravity                                                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chuẩn bị         | `git switch main && git pull --ff-only`, `make up && make verify`                                                                                     |
| Giao việc        | Cuộc trò chuyện **mới**, chọn Planning Mode (task lõi), gõ **`/task T-202`** (hoặc dán khối prompt của task trong `PROMPTS.md`)                       |
| **Cổng 1**       | Agent tạo Implementation Plan (artifact) + tóm tắt 10 dòng. Bạn duyệt: "OK" hoặc "Sửa: ..."                                                           |
| Agent làm        | Xem Task list/Walkthrough artifact; ngắt khi nó sửa file ngoài danh sách                                                                              |
| **Cổng 2**       | Mở panel **Review Changes**, đọc diff **theo thứ tự**: test → SQL/Lua/hợp đồng → logic. Chạy lại lệnh kiểm chứng trên terminal của bạn. Làm "phá thử" |
| Review chéo      | Cuộc trò chuyện mới, model khác: **`/review <nhánh> <ID>`**                                                                                           |
| Kết thúc         | Merge (squash), `STATUS.md` → `Done`, ghi 3 dòng vào sổ bảo vệ                                                                                        |

## 6. Mẹo để dùng hiệu quả

1. **Mỗi task một cuộc trò chuyện.** Hội thoại dài làm agent quên quy ước; nếu buộc phải tiếp tục, bảo nó đọc lại `AGENTS.md`, run report và `git log` rồi làm tiếp.
2. **Dùng `@` để trỏ file** (ví dụ `@docs/agent/TUAN_PLAN.md`, `@docs/adr/0005-saga-outbox-inbox.md`) thay vì dán nội dung; ngữ cảnh gọn hơn và luôn đúng phiên bản.
3. **Planning Mode cho task lõi, Fast Mode cho việc nhỏ.** Đừng dùng Fast Mode cho Lua, saga, migration.
4. **Ép bằng kiểm chứng, không bằng lời hứa.** Luôn yêu cầu agent dán đầu ra thật của `pnpm test`, `test:int`, `test:conc` vào run report. Không có số test thì chưa tin.
5. **Giữ phạm vi hẹp.** Nêu rõ "Ngoài phạm vi" và "chỉ sửa thư mục X". Agent có xu hướng làm thêm.
6. **Đừng cấp quyền truy cập DB trực tiếp cho agent qua MCP.** Nó vi phạm nguyên tắc "không chạm DB của service khác" và dễ gây hỏng dữ liệu. Chỉ chạy truy vấn qua `make psql s=<service>` do bạn kiểm soát.
7. **Chỉ cài MCP/extension khi có nhu cầu rõ** (ví dụ GitHub để đọc issue/PR). Mỗi công cụ thêm là thêm bề mặt rủi ro và tốn ngữ cảnh.
8. **Browser agent** hữu ích để kiểm tra giao diện (Grafana dashboard ở T-404/T-501, UI của Vũ); không cần cho việc backend.
9. **Song song có kiểm soát.** Antigravity cho chạy nhiều agent cùng lúc, nhưng quy tắc dự án là **không hai agent trên cùng một package**. Nếu muốn song song, dùng `git worktree` riêng cho mỗi task và mở thành workspace riêng (mỗi worktree cần `pnpm install` riêng).
10. **Ghi lại bài học.** Mỗi thứ Sáu hỏi: "agent làm sai ở đâu tuần này?" rồi sửa `AGENTS.md` hoặc `CONVENTIONS.md` (nhớ giữ `AGENTS.md` dưới 12.000 ký tự).
11. **Không tin lời giải thích thuyết phục.** Với điểm then chốt, đối chiếu code và test chạy thật.
12. **Windows:** nếu agent chạy lệnh `docker exec ... /opt/...` trong Git Bash, đặt `MSYS_NO_PATHCONV=1` (Makefile và script của repo đã tự đặt).

## 7. Khi nào nên tạo skill riêng

Skill (`.agents/skills/<tên>/SKILL.md`, có phần `description` mô tả khi nào dùng) nạp theo nhu cầu nên tiết kiệm ngữ cảnh, nhưng việc agent có tự kích hoạt hay không phụ thuộc vào mô tả, nên **không dùng skill cho luật bắt buộc** (đặt luật bắt buộc trong `AGENTS.md`). Chỉ tạo skill sau khi quy trình đã ổn định. Gợi ý, tạo **sau** khi làm xong task tương ứng:

| Skill                    | Tạo sau       | Nội dung                                                                |
| ------------------------ | ------------- | ----------------------------------------------------------------------- |
| `lua-script-testing`     | T-202         | Cách viết test đồng thời cho Lua (song song N tác vụ, kết quả xác định) |
| `prisma-sql-migration`   | T-201         | Quy trình `--create-only` + sửa tay SQL + kiểm tra chạy từ DB rỗng      |
| `k6-loadtest-report`     | T-205 / T-403 | Khuôn kịch bản k6, kiểm tra đúng đắn, khung báo cáo                     |
| `kafka-consumer-pattern` | T-103         | Mẫu consumer Inbox + DLQ dùng thư viện `outbox-inbox`                   |

Nhờ chính agent soạn bản nháp từ code đã có, rồi bạn rà lại.

## 8. Sự cố thường gặp

| Triệu chứng                                  | Cách xử lý                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Agent bỏ qua quy trình, code ngay            | Gõ lại `/task <ID>`; nhắc "đọc `AGENTS.md` mục 2, dừng ở Cổng 1"                                                                |
| Smoke test trả lời sai phần cuối `AGENTS.md` | File có thể bị cắt hoặc không nạp: kiểm tra Rules panel, đếm ký tự, tạo rule workspace trỏ tới file                             |
| `/task` không hiện                           | Tạo qua Workflows → + Workspace (mục 3.4), hoặc đổi tên thư mục `.agents` ↔ `.agent` theo phiên bản của bạn **(kiểm tra)**      |
| Skill không tự kích hoạt                     | Mô tả (`description`) chưa khớp ý định; gọi tường minh bằng cách nhắc tên skill trong yêu cầu                                   |
| Agent hết hạn mức giữa chừng                 | Cập nhật run report và commit; tiếp tục ở cuộc trò chuyện mới bằng prompt "đọc `AGENTS.md`, run report, `git log` rồi tiếp tục" |
| Agent chạy lệnh nguy hiểm                    | Bật Deny List (mục 3.3); xem lại task đó bằng `git status`/`git reflog` trước khi tiếp tục                                      |
