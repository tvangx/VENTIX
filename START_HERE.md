# START HERE — làm theo từng bước

Bạn chỉ cần đi từ trên xuống. Mỗi bước có checkbox. Prompt cho agent nằm trong `docs/agent/PROMPTS.md` (mở đúng khối của task, dán nguyên khối).
Giải thích sâu hơn nếu cần: `docs/dev/operating-guide.md` (cách duyệt, kiểm tra, đọc hiểu), `docs/PHASE0-setup-guide.md` (xử lý lỗi hạ tầng).

---

## Phần 1 — Cài đặt (30–45 phút, làm một lần)

### 1.1 Đưa repo lên máy và kiểm tra

```bash
unzip ticketing-platform-ready.zip && cd ticketing-platform
git init -b main                      # PHẢI git init trước pnpm install để husky gắn hook
bash scripts/check-prereqs.sh
cp .env.example .env
pnpm install
pnpm build && pnpm lint && pnpm typecheck && pnpm test     # phải xanh (event-contracts: 13 test)
make up && make verify                                      # chờ ~60 giây; phải ra "TẤT CẢ OK"
```

- [ ] Mọi lệnh trên xanh. Nếu `make verify` lỗi: xem bảng lỗi trong `docs/PHASE0-setup-guide.md` mục 5.
- [ ] MinIO dùng image Chainguard (`MINIO_IMAGE`, `MINIO_MC_IMAGE` trong `.env`). Không cần sửa gì thêm.

### 1.2 Thay tên GitHub, commit, đẩy lên

```bash
sed -i 's/@GH_TUAN/@<user-của-bạn>/g; s/@GH_SON/@<user-của-sơn>/g; s/@GH_VU/@<user-của-vũ>/g' .github/CODEOWNERS
git add -A && git commit -m "chore(repo): bootstrap monorepo, infra, agent conventions and saga contracts"
gh auth login
gh repo create <org-hoặc-user>/ticketing-platform --private --source=. --remote=origin --push
```

> Commit này **đã gồm** thay đổi hợp đồng saga (T-301a). Việc review nó nằm ở bước 1.5.

- [ ] Repo đã có trên GitHub, tab Actions chạy lần đầu (`build`, `security`). Chờ xanh. Lỗi Trivy/format thì dán log vào chat cho mình.

### 1.3 Nhãn, bảo vệ nhánh, issue

```bash
bash scripts/gh-bootstrap.sh          # nhãn + bảo vệ main (private gói Free: bước bảo vệ sẽ báo lỗi, bỏ qua được)
export GH_TUAN=<user> GH_SON=<user> GH_VU=<user>
DRY_RUN=1 ONLY_WEEK=1 bash scripts/create-issues.sh | head      # xem trước
ONLY_WEEK=1 bash scripts/create-issues.sh                       # tạo issue tuần 1 (mỗi thứ Hai tạo tuần kế tiếp)
```

- [ ] Mời Sơn, Vũ (quyền Write). Tạo Projects board: cột `Backlog / Ready / Doing / Review / Done`.
- [ ] Bảo vệ `main` (hoặc tự giữ kỷ luật không push thẳng).

### 1.4 Gửi tin cho hai bạn

- [ ] Gửi **Tin khởi động** và **Tin xác nhận hợp đồng saga** (`docs/dev/messages-for-team.md`, mục 1 và 2).

### 1.5 Việc của riêng bạn (không giao agent)

- [ ] **T-106:** đăng ký VNPay sandbox (lấy `vnp_TmnCode`, `vnp_HashSecret`); thử `cloudflared tunnel --url http://localhost:3004`; chạy `docker stats --no-stream` ghi RAM vào `docs/test-reports/ram-phase0.md`.
- [ ] **T-301a (review):** đọc `docs/adr/0009`, `docs/adr/0010`, `packages/event-contracts/src/events.ts` (khối `OrderAwaitingPayment`, `OrderConfirmed`). "Phá thử": tạm xóa khối `superRefine` của `OrderConfirmed`, chạy `pnpm --filter @ticketing/event-contracts test` → phải có test **đỏ**; `git restore .`. Khi Sơn và Vũ trả lời OK, đổi T-301a sang `Done` trong `docs/agent/STATUS.md`.
- [ ] **T-107 (workshop 30–45 phút):** xác nhận hợp đồng saga với Sơn/Vũ; chốt chính sách escrow (`messages-for-team.md` mục 3); thống nhất quy ước API: `/v1`, lỗi `application/problem+json`, phân trang cursor, header `Idempotency-Key`, thời gian UTC ISO-8601, khóa nội bộ `INTERNAL_API_KEY`.
- [ ] **T-105:** CI đã có; chỉ cần xác nhận chạy xanh và chọn 2 check `build`, `security` làm bắt buộc.

### 1.6 Chuẩn bị agent

- [ ] Tắt tự chạy (auto-run) cho `git push`, `rm`, `docker volume`, `make reset`.
- [ ] **Smoke test** (khối "Smoke test" cuối `PROMPTS.md`) trong phiên chat mới. Agent phải nêu đủ 10 luật, nói "làm một task rồi dừng", và nói sẽ tạo run report trước khi code. Sai → bảo nó mở và đọc `AGENTS.md`.

---

## Phần 2 — Chu trình cho MỖI task (làm đúng 7 bước này)

1. `git switch main && git pull --ff-only && git status` (sạch) · `make up && make verify`.
2. **Phiên chat mới**, dán prompt của task. Agent trả về **tóm tắt 10 dòng**.
3. **Cổng 1:** kiểm tra tóm tắt (đúng mục tiêu? file hợp lý? không đụng vùng người khác/hợp đồng? giả định ổn?). Trả lời **"OK"** hoặc **"Sửa: ..."**.
4. Agent làm. Ngắt ngay nếu nó: sửa file ngoài danh sách đã duyệt · định `git push`/xóa dữ liệu · sửa test cho qua · lặp cùng lỗi quá 2 lần.
5. **Cổng 2 (kiểm tra):** mở run report `docs/agent/runs/<ID>.md` (có số test thật?), rồi:

```bash
git fetch && git switch <nhánh> && pnpm install && make up
git diff main --stat                                    # có ngoài phạm vi?
git diff main -- . ':!pnpm-lock.yaml' | grep -nE '\.skip\(|\.only\(|xit\(|@ts-ignore|: any\b|console\.log|eslint-disable' || echo sạch
pnpm --filter <package> lint typecheck test test:int test:conc
pnpm format:check && pnpm build
```

Sau đó **"phá thử"** (bảng dưới): test phải đỏ khi code sai. 6. **Đọc code ở điểm quyết định:** test → SQL/Lua/hợp đồng → logic → nối dây. Mã lõi: nhờ **Sơn đọc cùng**, hoặc dùng prompt **Reviewer** trong phiên riêng. 7. Merge (squash) → `STATUS.md` sang `Done` → ghi 3 dòng vào `docs/learning/defense-notes.md` (Vấn đề · Giải pháp · Vì sao không chọn cách khác).

**Phiên chat mới cho task kế tiếp.** Task nào cũng dừng sau khi báo cáo; không để agent tự làm tiếp.

---

## Phần 3 — Thứ tự thực hiện

### Tuần 1 (mục tiêu: nền tảng, hạ tầng, chốt hợp đồng)

| #   | Task                                | Prompt trong PROMPTS.md   | Người đọc                  | "Phá thử" (test phải đỏ)                                      | Qua khi                                                 |
| --- | ----------------------------------- | ------------------------- | -------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | **T-102** Template service          | `T-102 Template service`  | Bạn (Sơn đọc `auth-guard`) | Cho `auth-guard` chấp nhận HS256 hoặc `none`                  | Sinh service `demo` chạy được, test xanh, đã xóa `demo` |
| 2   | **T-103** Outbox/Inbox              | `T-103 outbox-inbox`      | Bạn + Sơn                  | Bỏ `ON CONFLICT DO NOTHING` ở Inbox; bỏ `SKIP LOCKED` ở relay | 5 kịch bản Testcontainers xanh                          |
| 3   | **T-201** Schema `booking_db`       | `T-201 Schema booking_db` | Bạn + Sơn                  | Xóa dòng tạo `uq_seat_active`                                 | Chèn 2 allocation cùng ghế thì lỗi 23505                |
| 4   | **T-207** VPS (agent chỉ viết file) | `T-207 VPS compose prod`  | Bạn                        | —                                                             | `compose config` hợp lệ; bạn tự thuê VPS và deploy thử  |

_Song song:_ mục 1.5 (T-106, T-107, T-105, review T-301a) và nhận bàn giao từ Sơn/Vũ.
**Không có cổng** cuối tuần 1, nhưng cần: `make up/verify` xanh trên cả 3 máy, template dùng được, hợp đồng đã được xác nhận.

### Tuần 2 (mục tiêu: **Cổng G1 — oversell = 0**)

| #   | Task                             | Prompt                              | Người đọc | "Phá thử"                                              | Qua khi                                              |
| --- | -------------------------------- | ----------------------------------- | --------- | ------------------------------------------------------ | ---------------------------------------------------- |
| 5   | **T-202** Lua giữ ghế            | `T-202 Lua giữ ghế`                 | Bạn + Sơn | Trong Lua bỏ vòng kiểm tra xung đột (chỉ giữ vòng ghi) | 100 người tranh 1 ghế ra đúng 1; all-or-nothing      |
| 6   | **T-206** Kong                   | `T-206 Kong`                        | Bạn       | —                                                      | `scripts/check-kong.sh` thoát 0                      |
| 7   | **T-203** Consumer + rehydrate   | `T-203 Consumer event + rehydrate`  | Bạn       | Bỏ điều kiện `event_version <`                         | `FLUSHALL` rồi khởi động lại, ghế khớp DB            |
| 8   | **T-204** Seat status + SSE      | `T-204 Seat status + SSE + sweeper` | Bạn       | —                                                      | Giữ ghế → SSE nhận `H`; hết TTL → `A`                |
| 9   | **T-205** k6 S1                  | `T-205 k6 S1`                       | Bạn       | Chạy verifier với dữ liệu có 1 ghế bị giữ 2 lần        | **G1:** oversell = 0 + báo cáo số đo thật            |
| 10  | **T-203b** Prefetch seat_pricing | `T-203b Prefetch seat_pricing`      | Bạn       | Cho phiên bản cũ ghi đè phiên bản mới                  | `pricing_ready` đúng; chờ S-206 hoặc dùng server giả |

Thứ tự: 5 → 6 → 7 → 8 → 9; làm 10 ngay khi Sơn xong S-206 (không chặn G1).
**Demo thứ Sáu (G1):** `make up`, chạy k6 S1, chạy verifier, cho cả nhóm xem kết quả; Redis `FLUSHALL` rồi rehydrate.

### Tuần 3 (mục tiêu: **Cổng G2 — luồng mua vé chạy trọn vẹn**)

| #   | Task                           | Prompt                         | Người đọc | "Phá thử"                                                               | Qua khi                                       |
| --- | ------------------------------ | ------------------------------ | --------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| 11  | **T-301** Checkout             | `T-301 Checkout`               | Bạn + Sơn | Bỏ điều kiện `sold + :q <= total`; bỏ kiểm tra hash của Idempotency-Key | Mọi kiểm chứng trong prompt xanh              |
| 12  | **T-302** Payment + adapter    | `T-302 Payment + adapter`      | Bạn       | Cho verify chữ ký luôn trả đúng                                         | Mock chạy hết luồng; bạn tự thử VNPay sandbox |
| 13  | **T-303** IPN + saga + sweeper | `T-303 IPN + sweeper + bù trừ` | Bạn + Sơn | Bỏ `ON CONFLICT (provider_txn_id)`                                      | Các ca biên (IPN trùng, đến muộn) có test     |
| 14  | **T-304** Waiting Room         | `T-304 Waiting Room`           | Bạn       | Bỏ khóa Redis của admission worker                                      | 2 replica không admit gấp đôi                 |

Làm 11 → 12 → 13 → 14. **T-304 được phép trượt sang đầu tuần 4** mà không chặn G2 (G2 chấp nhận `ADMISSION_REQUIRED=false`), nhưng phải xong trước load test vòng 1.
**Demo thứ Sáu (G2):** chọn ghế → checkout → thanh toán (Mock; VNPay sandbox nếu đã có) → `OrderConfirmed` → vé được phát (cần Sơn S-301). IPN gửi trùng và order hết hạn không làm mất ghế/trùng vé.

### Tuần 4 (mục tiêu: hoàn tiền đúng, sổ cái, **số đo thật vòng 1**)

Nếu T-304 trượt từ tuần 3 thì làm nó **đầu tuần**. Tuần 4 của bạn đầy (5,0 ngày): nếu trễ, cắt theo mục 7 của `TUAN_PLAN.md` (mục [C]/[S] của T-402 trước, rồi dời T-404 sang đầu tuần 5).

| #   | Task                           | Prompt                         | Người đọc | "Phá thử"                                                     | Qua khi                                            |
| --- | ------------------------------ | ------------------------------ | --------- | ------------------------------------------------------------- | -------------------------------------------------- |
| 15  | **T-401** Refund               | `T-401 Refund và tự hoàn tiền` | Bạn + Sơn | Bỏ `UNIQUE(payment_id)`; bỏ `SKIP LOCKED` ở worker            | 6 kiểm chứng trong prompt xanh                     |
| 16  | **T-402** finance-service      | `T-402 finance-service`        | Bạn + Sơn | Bỏ constraint trigger cân bằng; sửa tay một dòng `audit_logs` | Nợ = Có; `verify` bắt được chuỗi bị sửa            |
| 17  | **T-404** Prometheus + Grafana | `T-404 Prometheus và Grafana`  | Bạn       | —                                                             | Dashboard RED có dữ liệu                           |
| 18  | **T-403** Load test vòng 1     | `T-403 Load test vòng 1`       | Bạn       | Chạy `verify-consistency` với dữ liệu cố ý sai                | Báo cáo có số **thật**; bạn chạy k6 từ máy thứ hai |
| 19  | **T-405** Payment resale       | `T-405 Payment cho đơn resale` | Bạn       | Gửi cả hai khóa `order_id` và `resale_order_id`               | 422; IPN trùng chỉ 1 `PaymentSucceeded`            |

Thứ tự: 15 → 16 → 17 → 18 → 19. T-405 chờ S-405 của Sơn (hoặc dùng sự kiện giả).
**Demo thứ Sáu:** hủy một sự kiện có đơn đã thanh toán ⇒ hoàn lô chạy hết, sổ cái cân bằng, số liệu vòng 1 đưa lên màn hình.

### Tuần 5 (mục tiêu: **Cổng G3 — đóng băng tính năng**)

| #   | Task                       | Prompt                    | Người đọc | "Phá thử"                                                                 | Qua khi                                                 |
| --- | -------------------------- | ------------------------- | --------- | ------------------------------------------------------------------------- | ------------------------------------------------------- |
| 20  | **T-501** Giám sát đầy đủ  | `T-501 Giám sát đầy đủ`   | Bạn       | —                                                                         | Tìm 1 đơn theo `request_id` thấy log ≥ 3 service        |
| 21  | **T-502** Chaos S4         | `T-502 Chaos S4`          | Bạn       | Bỏ `commandTimeout`/`enableOfflineQueue:false` rồi chạy test "Redis down" | Kịch bản 1–4 đạt (bạn chạy thật)                        |
| 22  | **T-503** Hardening        | `T-503 Hardening bảo mật` | Bạn       | —                                                                         | ZAP không còn lỗi cao; checklist OWASP có bằng chứng    |
| 23  | **T-505** Pipeline deploy  | `T-505 Pipeline deploy`   | Bạn       | Cố ý làm smoke test fail                                                  | Tự quay về bản trước; merge `main` thì staging cập nhật |
| 24  | **T-504** Load test vòng 2 | `T-504 Load test vòng 2`  | Bạn       | —                                                                         | `loadtest-2.md` so sánh với vòng 1, số **thật**         |

Thứ tự: 20 → 21 → 22 → 23 → 24 (T-504 làm sau cùng vì cần các bản sửa trước đó). Bạn tạo GitHub environments và secrets trước khi giao T-505.
**Cổng G3:** mọi mục [M] và [S] của tuần 1–5 xong; có `loadtest-1`, `loadtest-2`, `chaos-s4`, `zap`, `hardening-checklist`; mục [C] chưa làm ghi vào hạn chế đã biết. **Từ thứ Hai tuần 6 không thêm tính năng.**

### Tuần 6 (mục tiêu: **Cổng G4 — sẵn sàng bảo vệ**)

| #   | Task                                  | Prompt                                      | Người đọc                      | Qua khi                                                                                                     |
| --- | ------------------------------------- | ------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 25  | **T-601** Deploy production           | `T-601 Deploy production`                   | Bạn                            | Truy cập bằng domain qua HTTPS; **bạn đã diễn tập khôi phục thật** và điền thời gian vào `restore-drill.md` |
| 26  | **T-602** Load/chaos cuối             | `T-602 Load test cuối trên môi trường thật` | Bạn                            | `performance-final.md` có số thật, mọi số có nguồn                                                          |
| 27  | **T-603** Tài liệu cuối               | `T-603 Tài liệu cuối`                       | Bạn + Sơn/Vũ đọc phần của mình | Danh sách chỗ lệch tài liệu–code đã xử lý                                                                   |
| 28  | **T-604** Reset demo + câu hỏi bảo vệ | `T-604 Sửa lỗi và chuẩn bị bảo vệ`          | Bạn                            | Đã tập dượt ít nhất 2 lần, có video dự phòng                                                                |

Thứ tự: 25 → 26; 27 làm song song; 28 cuối cùng. Lỗi phát sinh dùng prompt **"Sửa lỗi"** (mỗi lỗi một nhánh).

---

## Phần 4 — Khi có chuyện

| Tình huống                               | Làm gì                                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Agent hỏi lại / dừng ở mục 9             | Trả lời một lần, rõ ràng. Quyết định quan trọng thì ghi vào run report mục 4                                                       |
| Test fail, agent sửa mãi không được      | Ngắt: _"Tóm tắt đã thử gì, kết quả, giả thuyết còn lại. Chưa sửa tiếp cho tới khi tôi trả lời."_                                   |
| Agent làm ngoài phạm vi                  | _"Hoàn tác phần ngoài phạm vi (liệt kê); giữ đúng đặc tả."_                                                                        |
| Báo "đã pass" không có số liệu           | _"Chạy lại, dán đầu ra thật của từng lệnh vào run report mục 5."_                                                                  |
| Phiên chat quá dài, bắt đầu quên quy ước | Bảo nó cập nhật run report và commit; mở phiên mới: _"Đọc AGENTS.md, docs/agent/runs/<ID>.md và git log nhánh này, rồi tiếp tục."_ |
| `make verify` lỗi                        | `docs/PHASE0-setup-guide.md` mục 5; vẫn chưa được thì dán log cho mình                                                             |
| Muốn đổi hợp đồng/ADR                    | Không để agent tự đổi. Bạn quyết, ghi ADR mới, rồi mới giao                                                                        |
| Sơn/Vũ trễ làm bạn bị chặn               | Dùng server giả/seed theo prompt (T-203, T-203b, T-301 đã có đường dự phòng) và làm task kế tiếp                                   |

## Phần 5 — Mỗi thứ Sáu (15 phút)

- [ ] Demo theo cổng của tuần; cập nhật `STATUS.md`.
- [ ] Hỏi: _"Agent làm sai ở đâu tuần này, cần sửa `AGENTS.md` thế nào?"_ và sửa luôn.
- [ ] Tạo issue tuần kế tiếp: `ONLY_WEEK=<n> bash scripts/create-issues.sh`.
- [ ] Mỗi tính năng xong: cập nhật tài liệu liên quan trong tuần (SRS/ERD/sequence), đừng dồn.
