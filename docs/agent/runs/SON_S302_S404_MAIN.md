# Run report — Tích hợp S-302–S-404 lên main

Ngày 2026-11-12. Nhánh `chore/son-s302-s404-main`, worktree riêng từ origin/main 0977e9d. Người giao việc đã yêu cầu làm xếp chồng và đưa vào main sau CI/phê duyệt, đồng thời giữ từng PR task.

## Đối chiếu trước tích hợp

- S-301 đã vào main qua #70. `git diff be78d1d origin/main -- services/ticket` rỗng, xác nhận source Ticket S-301 trên main bằng base gốc của chuỗi xếp chồng.
- #71/#73/#74/#75/#76/#77 đã merge các base xếp chồng trước đó. #79/#80/#81 merge thường vào `feat/ticket-s401-staff-packages`, hiện b98d7c8.
- S-404 #81 head 62304ab đã có build/security xanh ở run 43196931472 attempt 3. Hai lượt trước timeout hai test JWKS cũ khác nhau, mỗi lượt 19/20 pass, giữ source và threshold qua rerun. Ticket 22 unit/68 integration/11 concurrency, Resale 9 unit/23 integration/4 concurrency và lint/typecheck/unit/format/build toàn repo đã pass local.
- Main có Event tuần 2 qua #69 và Web V-103 qua #78, cần giữ đầy đủ khi tích hợp. Worktree S-405 ở s301 giữ riêng precheck/policy cho #82/#83.
- Các PR task vẫn có lịch sử riêng. PR tích hợp này đưa code đã có trong chuỗi lên main và tuân thủ bảo vệ main.

## Kế hoạch trước merge

- Merge origin/feat/ticket-s401-staff-packages vào nhánh mới từ main. Resolve Ticket theo source chuỗi xếp chồng sau khi đã chứng minh main chỉ có bản S-301 tương đương. Giữ Event/V-103 trên main, ghép trạng thái và lịch sử docs theo bằng chứng GitHub.
- Kiểm tra diff từng vùng, migration và lockfile. Tái dùng dependency repo, giữ những thay đổi thuộc worktree khác.
- Frozen install, lint/typecheck/unit, build/format, Ticket/Resale integration/concurrency thật và regression Identity/Event liên quan nếu có thay đổi khi hợp nhất.
- Mở PR main để reviewer có quyền approve, theo dõi CI. Chỉ merge main sau khi GitHub xác nhận đủ CI/review.

## Kiểm chứng

- Merge phát sinh conflict ở 12 file Ticket và 2 tài liệu trạng thái. Đã lấy các file Ticket từ chuỗi S-404 sau khi chứng minh source main S-301 bằng base gốc. Ghép các hunk trạng thái, giữ các dòng Done tuần 1/2 đã có ở main và thêm các dòng S-401–404 từ chuỗi.
- `git diff origin/main -- apps services/event .github infra services/booking services/payment services/finance` rỗng. `git diff origin/feat/ticket-s401-staff-packages -- services/ticket services/resale services/identity packages/event-contracts` rỗng. Source main và chuỗi được đối chiếu theo từng vùng sau resolve.
- Lockfile auto-merge có 43 dòng thêm so main, thuộc dependency Identity/Resale đã có trong PR task. Frozen install giữ nguyên resolution và hoàn tất. Lượt offline thiếu supports-color 10.2.2 của dependency main V-103, retry frozen online tải 45 package theo lockfile.
- Optional cpu-features install thiếu compiler native trên Windows, pnpm install vẫn exit 0. Các kiểm chứng ứng dụng tiếp tục theo entry point bình thường.
- Build mới 16/16 package, cache 0, và lint 20/20 task pass trên worktree tích hợp. Format toàn repo và diff check pass.
- Ticket integration đầy đủ 68/68 pass. Resale integration chạy lại đầy đủ 23/23 pass. Lượt Resale đầu có hook khởi tạo hai DB vượt 120 giây khi máy còn 912 MB RAM trống, 13 ca khác pass, process Jest bị giữ bởi fixture khởi tạo muộn. Đã dừng đúng process Resale đã hoàn tất và pipeline kiểm chứng thuộc worktree này, rồi chạy lại cả bộ với tải giảm. Threshold và assertion được giữ trong lượt retry.
- Typecheck và unit đang chạy tuần tự. Pipeline đầu đã được dừng sau build/lint và trong typecheck để giảm tải máy, sau đó chạy lại typecheck. Các package Jest chạy --runInBand trong lượt mới, test Vitest dùng entry point hiện hành.
- Typecheck chạy lại 20/20 task pass, 6 task dùng cache. Unit 312/312 pass trên 16 package, Jest chạy tuần tự/in-band và Vitest theo script hiện hành. Tổng gồm service-template 4, Booking 76, Event 12, Finance 9, Identity 23, Merch 4, Notification 4, Payment 21, Resale 9, Ticket 22, Common 10, Outbox/Inbox 20, Auth Guard 20, contracts 29 và Web 49. Staff PWA trả exit 0 với 0 test theo cấu hình hiện hành.
- GitHub cho thấy PR tài liệu S-405 #83 đã được merge vào base tại 7c6d577 trong lúc kiểm chứng. Đã merge tiếp commit này, ghép hunk SON_STATUS và ghi rõ S-405 code đang chờ hợp đồng #82. Chính sách escrow và precheck đã có trong PR riêng #83. Source nghiệp vụ vẫn bằng chuỗi S-404.
- Concurrency Ticket 11/11 và Resale 4/4 đã pass trên nhánh S-404, đang chạy lại tuần tự trên worktree tích hợp. Các ca HTTP mới có 50 request, cùng các ca race check-in/offline hiện hành.
