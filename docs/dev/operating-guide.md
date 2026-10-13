# Sổ tay vận hành: làm việc với agent để triển khai

**Dành cho:** Tuấn · **Mục tiêu:** giao việc đúng cách, duyệt có hệ thống, kiểm tra được, và **hiểu mình đang xây gì** để bảo vệ được.

---

## 1. Mô hình làm việc

Bạn không viết từng dòng code, nhưng bạn **chịu trách nhiệm** về từng dòng được merge. Vì vậy vai trò của bạn là **người ra đề và người duyệt**; agent là người thực thi.

```
Giao việc  →  Duyệt kế hoạch (10 dòng)  →  Agent làm  →  Duyệt kết quả  →  Merge
 (prompt)        (cổng 1: bạn nói OK)                    (cổng 2: kiểm tra)
```

Hai cổng này là toàn bộ cơ chế kiểm soát chất lượng. **Cổng 1 rẻ nhất:** sai hướng được phát hiện trước khi có 500 dòng code. **Cổng 2** cần kỷ luật: không merge khi chưa tự chạy lại và chưa hiểu các điểm quyết định.

Nguyên tắc cho cả dự án:

1. **Một task, một phiên chat, một nhánh, một PR.** Không gộp.
2. **Không tin báo cáo, hãy kiểm tra.** Báo cáo của agent là lời khai, chạy lại trên máy bạn mới là bằng chứng.
3. **Mã lõi phải được đọc bởi 2 người** (bạn + Sơn): Lua, outbox/inbox, saga, state machine, unique index, mã hóa, TOTP.
4. **Chưa hiểu thì chưa merge.** Mục 7 hướng dẫn cách hiểu nhanh.

---

## 2. Chuẩn bị một lần (trước task đầu tiên)

- [ ] `git status` sạch; đã giải nén `agent-pack.zip` vào gốc repo, commit và push lên `main` (`chore(docs): add agent conventions`).
- [ ] `make up && make verify` ra `TẤT CẢ OK` (đã vá Git Bash).
- [ ] `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test` xanh trên `main`.
- [ ] **Cấu hình quyền của agent trong IDE:** tắt chế độ tự chạy (auto-run/auto-approve) cho lệnh `git push`, `rm`, `docker volume`, `docker compose down -v`, `make reset`. Để agent được tự đọc file, sửa file, chạy `pnpm`/`jest`. Tên cài đặt tùy IDE, bạn tìm mục "permissions/allowlist".
- [ ] Đặt `main` được bảo vệ (hoặc tự giữ kỷ luật không push thẳng).
- [ ] **Smoke test agent** (10 phút): mở phiên chat mới, dán prompt dưới đây. Nếu agent không trích đúng, nghĩa là nó **không đọc** `AGENTS.md`: kiểm tra file nằm ở gốc repo và IDE có nạp (nếu không, bảo nó mở file rồi hỏi lại).

```text
Đọc AGENTS.md. Không làm gì khác. Trả lời: (1) liệt kê 10 luật ở mục 0 bằng lời của bạn,
(2) nếu tôi bảo "làm T-202 và T-203 luôn đi" thì bạn làm gì, (3) khi nào bạn phải dừng và hỏi,
(4) bạn tạo file nào trước khi viết code.
```

Đáp án đúng: (2) làm một task rồi dừng, trừ khi bạn nói rõ chế độ lô; (4) run report `docs/agent/runs/T-xxx.md` với mục Kế hoạch.

---

## 3. Thứ tự thực hiện

Thứ tự đầy đủ, kèm prompt, người đọc và "phá thử" cho từng task nằm trong **`START_HERE.md` mục Phần 3**. Tóm tắt:

| Tuần | Thứ tự                                                                          | Cổng                                                     |
| ---- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1    | T-102 → T-103 → T-201 (+ T-207); song song T-105, T-106, T-107 và review T-301a | `make verify` xanh trên cả 3 máy; hợp đồng được xác nhận |
| 2    | T-202 → T-206 → T-203 → T-204 → T-205; T-203b khi Sơn xong S-206                | **G1:** oversell = 0                                     |
| 3    | T-301 → T-302 → T-303 → T-304 (T-304 được trượt sang đầu tuần 4)                | **G2:** luồng mua vé chạy trọn vẹn                       |
| 4    | T-401 → T-402 → T-404 → T-403 → T-405                                           | Số đo thật vòng 1; hoàn tiền đúng một lần                |
| 5    | T-501 → T-502 → T-503 → T-505 → T-504                                           | **G3:** đóng băng tính năng                              |
| 6    | T-601 → T-602; T-603 song song; T-604                                           | **G4:** sẵn sàng bảo vệ                                  |

Ghi chú:

- **T-301a** (hợp đồng saga) đã được cài đặt sẵn và nằm trong repo; bạn chỉ review và chờ Sơn/Vũ xác nhận, **không giao cho agent**.
- **Song song được:** việc chỉ có tài liệu, việc của bạn (VNPay, VPS, domain), hoặc hai task ở hai package không phụ thuộc nhau. **Không** chạy hai agent trên cùng một package hoặc nhánh.
- **Khi bị chặn bởi Sơn/Vũ** (T-203 chờ S-203, T-203b chờ S-206, T-301 chờ V-306): các prompt đã có đường dự phòng (server giả, script seed).

---

## 4. Vòng lặp cho mỗi task

### Bước A — Chuẩn bị (2 phút)

```bash
git switch main && git pull --ff-only && git status      # phải sạch
make up && make verify                                    # nếu task đụng DB/Kafka/Redis
```

Mở `docs/agent/STATUS.md`: phụ thuộc đã `Done` chưa.

### Bước B — Giao prompt trong phiên **mới**

Đổi `<T-xxx>`. Giữ dòng cuối _"chờ tôi nói OK"_ cho mọi task mã lõi.

### Bước C — Duyệt bản tóm tắt 10 dòng (cổng 1)

Đọc và tự hỏi:

| Câu hỏi                                       | Dấu hiệu xấu                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Agent hiểu đúng **mục tiêu** không?           | Mô tả khác với đặc tả trong `TUAN_PLAN.md`                                         |
| Danh sách **file** có hợp lý không?           | Sửa file ngoài phạm vi (service của Sơn/Vũ, `event-contracts` khi không được giao) |
| Có **giả định** nào ảnh hưởng thiết kế không? | Giả định về hợp đồng, về chính sách nghiệp vụ                                      |
| Có định **thêm thư viện** không?              | Thư viện lớn, ít bảo trì, thay thế được bằng thứ đã có                             |
| Kế hoạch **test** có đủ ca khó không?         | Chỉ có test đường thành công                                                       |

Trả lời một trong hai: **"OK"** hoặc **"Sửa: ..."** (nêu cụ thể). Đừng nói "OK" khi chưa hiểu kế hoạch. Hỏi lại agent: _"Giải thích điểm X bằng ví dụ"_ (xem mục 8).

### Bước D — Agent làm: khi nào can thiệp

- **Cứ để chạy** khi nó đang viết code, chạy test, sửa lỗi của chính nó.
- **Ngắt ngay** khi: nó sửa file ngoài danh sách đã duyệt · nó định `git push`/xóa dữ liệu · nó sửa test để cho qua · nó lặp lại cùng lỗi quá 2 lần · nó nói "tôi giả định..." về hợp đồng mà không hỏi.

### Bước E — Phân loại báo cáo (5 phút, mục 5 Tầng 1)

### Bước F — Kiểm tra trên máy bạn (10–20 phút, mục 5 Tầng 2)

### Bước G — Đọc code ở điểm quyết định (20–40 phút, mục 5 Tầng 3)

### Bước H — Merge và ghi sổ

- Squash merge. Bạn đổi `STATUS.md` sang `Done`.
- Viết **3 dòng vào sổ bảo vệ** (mục 7.5).
- Task kế tiếp: mở **phiên chat mới**.

---

## 5. Cách review: ba tầng

### Tầng 1 — Phân loại báo cáo (5 phút)

Mở `docs/agent/runs/T-xxx.md` và PR. Kiểm tra:

- [ ] Bảng **Kiểm chứng** có **số liệu thật** (ví dụ `42 passed, 0 failed`), không chỉ chữ "pass".
- [ ] Mục **"Không chạy được/chưa kiểm chứng"** có ghi gì không. Nếu có, bạn phải tự chạy phần đó.
- [ ] Số test **không giảm** so với trước.
- [ ] **Giả định** và **thay đổi hợp đồng** có được nêu; không có gì bất ngờ.
- [ ] **Thư viện mới:** có lý do, giấy phép.

Chạy các lệnh phát hiện "mùi" (trên nhánh của task):

```bash
git diff main --stat                                         # file nào bị đụng? có ngoài phạm vi không?
git diff main -- . ':!pnpm-lock.yaml' | grep -nE '\.skip\(|\.only\(|xit\(|xdescribe|@ts-ignore|: any\b|console\.log|eslint-disable' || echo "sạch"
git diff main -- '*.json' ':!pnpm-lock.yaml' | grep -n '"dependencies"\|"devDependencies"' # thư viện mới
git diff main --name-only | grep -E '\.env$|secret|\.pem$' && echo "NGUY HIỂM" || echo "không có secret"
git diff main --name-only | grep 'migrations/' # migration cũ có bị sửa không? (chỉ được THÊM migration mới)
```

### Tầng 2 — Chạy lại trên máy bạn (10–20 phút)

```bash
git fetch && git switch <nhánh-của-task> && pnpm install
make up && make verify
pnpm --filter <package> lint typecheck test test:int test:conc
pnpm format:check && pnpm build
```

So kết quả với báo cáo. Khác nhau ⇒ dừng, hỏi agent vì sao. Sau đó **"phá thử"** (mục 6): đây là bước kiểm chứng test thật sự có tác dụng.

### Tầng 3 — Đọc code ở điểm quyết định (20–40 phút)

**Thứ tự đọc một PR** (đừng đọc từ trên xuống theo thứ tự file):

1. **Run report mục 4 (Quyết định/lệch spec)**: biết agent đã tự quyết điều gì.
2. **Test trước**: test mô tả hành vi mong muốn. Nếu test sai hoặc thiếu ca khó thì code đúng cũng vô nghĩa.
3. **Hợp đồng/schema/SQL**: migration, OpenAPI, schema sự kiện, file `.lua`.
4. **Logic lõi** (service, state machine, consumer).
5. **Phần nối dây** (module, controller, config). Lướt nhanh.

**Điểm đọc kỹ theo loại mã**

| Loại                     | Câu hỏi bắt buộc tự trả lời                                                                                    | Dấu hiệu xấu                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Lua / Redis**          | Kiểm tra và ghi có nằm **trong cùng một script** không? Thất bại giữa chừng có ghi dở không? Key có TTL không? | `GET` rồi `SET` ở hai lệnh riêng trong TypeScript; `KEYS`; key không có hash tag |
| **SQL / migration**      | Ràng buộc có do **DB** bảo đảm (unique, CHECK) hay chỉ bằng `if` trong code? Migration chạy được từ DB rỗng?   | Kiểm tra trùng bằng `SELECT` rồi `INSERT` (race condition); sửa migration cũ     |
| **Transaction / Outbox** | Ghi nghiệp vụ và ghi outbox có **cùng transaction** không? Rollback thì sao?                                   | `producer.send` trực tiếp trong handler; outbox ghi sau khi commit               |
| **Consumer (Inbox)**     | Message trùng xử lý mấy lần? Sai schema đi đâu? Xử lý và đánh dấu đã xử lý có cùng transaction?                | `try/catch` nuốt lỗi; không có `processed_events`                                |
| **State machine**        | Chuyển trạng thái có điều kiện `WHERE status=:from AND version=:v` và kiểm tra số dòng ảnh hưởng?              | `UPDATE ... SET status=...` không điều kiện                                      |
| **Idempotency**          | Gọi lại cùng request cho kết quả giống nhau? Cùng key khác nội dung bị chặn?                                   | Chỉ kiểm tra key, bỏ qua hash nội dung                                           |
| **API / bảo mật**        | Quyền + tenant có được kiểm tra? Giá/số tiền lấy từ server hay tin client? Có log token/PII?                   | Nhận giá từ body; `console.log(req.body)`                                        |
| **Cấu hình**             | Biến mới đã vào `.env.example` + schema zod? Có giá trị mặc định nguy hiểm?                                    | `process.env.X \|\| 'secret'`                                                    |

### Review chéo bằng một agent thứ hai

Với mã lõi, mở **phiên chat mới** (agent không thấy ngữ cảnh cũ nên ít thiên vị) và dán:

```text
Bạn là reviewer khó tính, KHÔNG viết code. Đọc AGENTS.md mục 4 đến 7, rồi xem diff của nhánh <tên-nhánh> so với main
(git diff main). Đây là task <T-xxx>, đặc tả trong docs/agent/TUAN_PLAN.md.
Tìm: (1) race condition và chỗ kiểm-tra-rồi-ghi không atomic, (2) ca lỗi/trùng lặp chưa có test,
(3) chỗ lệch khỏi đặc tả hoặc ADR, (4) rủi ro bảo mật, (5) test yếu (test không thật sự kiểm tra điều nó tuyên bố).
Mỗi phát hiện ghi: file:dòng, mức độ (chặn/nên sửa/nhỏ), vì sao, gợi ý sửa. Cuối cùng đưa 3 ca test bổ sung đáng viết nhất.
Không khen, không tóm tắt lại diff.
```

Kết quả reviewer chỉ là gợi ý: bạn đánh giá từng phát hiện, rồi chuyển các mục chặn cho agent làm bằng prompt "Sửa theo review" trong `PROMPTS.md`.

---

## 6. Cách kiểm tra: không chỉ xem test xanh

Test xanh chỉ có giá trị nếu **test sẽ đỏ khi code sai**. Hãy chứng minh điều đó bằng **"phá thử" (sabotage)**: cố ý làm hỏng code ở nhánh cục bộ (không commit), chạy lại test, test **phải đỏ**. Test vẫn xanh ⇒ test vô dụng, trả lại cho agent. Xong thì `git restore .`.

| Task      | Phá thử                                                                  | Test nào phải đỏ                                |
| --------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| **T-102** | Cho `auth-guard` chấp nhận thêm thuật toán HS256 hoặc `none`             | Test token sai thuật toán                       |
| **T-103** | Bỏ `ON CONFLICT DO NOTHING` ở Inbox; bỏ `FOR UPDATE SKIP LOCKED` ở relay | Test message trùng; test hai relay song song    |
| **T-201** | Xóa dòng `CREATE UNIQUE INDEX uq_seat_active` khỏi migration             | Test chèn 2 allocation cùng ghế                 |
| **T-202** | Trong Lua, bỏ vòng kiểm tra xung đột (chỉ giữ vòng ghi)                  | Test 100 người tranh 1 ghế; test all-or-nothing |
| **T-203** | Bỏ điều kiện `event_version <` ở upsert                                  | Test sự kiện cũ đến sau sự kiện mới             |
| **T-301** | Bỏ điều kiện `sold + :q <= total`; bỏ kiểm tra hash của Idempotency-Key  | Test GA hết vé; test `IDEMPOTENCY_KEY_REUSED`   |
| **T-303** | Bỏ `ON CONFLICT (provider_txn_id)`                                       | Test IPN gửi trùng                              |
| **T-304** | Bỏ khóa Redis của admission worker                                       | Test hai replica không admit gấp đôi            |

**Nhìn tận mắt dữ liệu** (dev only, mất 5 phút, rất đáng):

```bash
# Redis: xem key ghế
make redis-cli
> SCAN 0 MATCH seat:* COUNT 100
> GET "seat:{evt:<eventId>}:<seatId>"       # H:<userId> hoặc S
> TTL "seat:{evt:<eventId>}:<seatId>"       # phải > 0 khi đang giữ
> SMEMBERS "hold:{evt:<eventId>}:<userId>"
> ZRANGE "hexp:{evt:<eventId>}" 0 -1 WITHSCORES

# PostgreSQL: xem bảng, index, dữ liệu
make psql s=booking
booking_db=> \dt
booking_db=> \d seat_allocations           # phải thấy uq_seat_active và CHECK
booking_db=> SELECT status, count(*) FROM orders GROUP BY 1;
booking_db=> SELECT * FROM outbox_events ORDER BY created_at DESC LIMIT 5;

# Kafka: xem message (http://localhost:8089)
make tools
```

Xem thêm ở Kafka UI: topic có message đúng `type`, `key`, `message_id`; `*.dlq` trống khi mọi thứ bình thường.

**Tiêu chuẩn "xong"** của một task: (1) test xanh trên máy bạn; (2) "phá thử" làm test đỏ; (3) bạn tự giải thích được 3 điểm quyết định (mục 7.4); (4) STATUS và tài liệu đã cập nhật.

---

## 7. Cách đọc hiểu: để biết mình đang xây gì

### 7.1 Năm ý tưởng giữ trong đầu (mọi task đều là biến thể của chúng)

| Ý tưởng                          | Nói bằng lời                                                                                            | Nằm ở đâu trong code                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Redis nhanh, PostgreSQL đúng** | Redis chặn đám đông, DB là chốt chặn cuối. Mất Redis vẫn không bán trùng                                | `*.lua` + `uq_seat_active`                |
| **Outbox**                       | "Ghi sổ trước, gửi thư sau": sự kiện nằm trong cùng transaction với dữ liệu, một tiến trình khác gửi đi | `outbox_events`, `OutboxRelay`            |
| **Inbox**                        | "Mỗi lá thư chỉ đọc một lần": ghi nhận message đã xử lý để nhận trùng cũng không làm lại                | `processed_events`, `createInboxConsumer` |
| **Saga**                         | Giao dịch dài qua nhiều service = chuỗi bước + bước **bù trừ** khi có bước hỏng                         | Consumers của booking/payment/merch       |
| **State machine**                | Order chỉ đi theo những đường hợp lệ; mọi chuyển trạng thái đều có điều kiện                            | `order-state.ts`                          |

### 7.2 Đọc một đoạn Lua trong 3 phút (`hold_seats`)

Hình dung đây là **một quầy giữ chỗ chỉ phục vụ một người tại một thời điểm** (Redis chạy Lua tuần tự, không ai chen vào giữa):

1. _Vòng 1, chỉ nhìn:_ với mỗi ghế, nếu đang có người **khác** giữ thì **dừng cả lệnh**, trả về ghế bị trùng. Chưa ghi gì.
2. _Kiểm tra hạn mức:_ tổng số ghế sau khi giữ có vượt `maxSeats` không.
3. _Vòng 2, mới ghi:_ đặt tất cả ghế, đặt TTL, thêm vào tập của user, báo delta.
   Vì vậy **hoặc giữ được tất cả, hoặc không giữ gì**. Nếu viết hai vòng này thành hai lệnh riêng trong TypeScript, giữa chúng có người chen vào ⇒ đó là lý do bắt buộc dùng Lua.

### 7.3 Đọc một PR trong 20 phút

Theo thứ tự mục 5 Tầng 3. Mỗi file, tự hỏi ba câu: **"Cái này giải quyết vấn đề gì?"** · **"Nếu nó không có thì điều tệ nào xảy ra?"** · **"Nếu hai việc xảy ra cùng lúc thì sao?"** Không trả lời được câu nào ⇒ hỏi agent (mục 8).

### 7.4 Tự kiểm tra hiểu biết trước khi merge

Bạn nên trả lời được **mà không nhìn code**. Nếu không, đó là phần cần học thêm, và hội đồng cũng sẽ hỏi chính các câu này.

- **T-202:** Hai người cùng giữ ghế A trong cùng một mili-giây: điều gì đảm bảo chỉ một người thắng? Redis restart thì sao? Vì sao dùng hash tag `{evt:...}`?
- **T-201 và T-301:** Redis báo cho phép nhưng DB từ chối: kết quả với khách là gì? Vì sao cần cả hai lớp?
- **T-103:** Relay gửi xong nhưng chết trước khi đánh dấu `published_at`: chuyện gì xảy ra với consumer? Vì sao vẫn đúng?
- **T-301:** Khách bấm "thanh toán" hai lần: điều gì xảy ra? Vì sao giá không lấy từ client?
- **T-303:** Thanh toán thành công nhưng order đã hết hạn: quy trình nào chạy, vì sao không "hồi sinh" order?
- **Chung:** Vì sao mỗi service một database? Cái giá phải trả là gì? Lấy dữ liệu của service khác bằng cách nào?

### 7.5 Sổ bảo vệ (3 dòng cho mỗi task)

Tạo file `docs/learning/defense-notes.md` (hoặc dùng Notion/Docs) và sau mỗi task ghi:

```
T-202 — Vấn đề: giữ nhiều ghế không atomic bằng SETNX lặp.
        Giải pháp: Lua all-or-nothing + unique index làm chốt chặn cuối.
        Vì sao không chọn cách khác: khóa hàng trong PostgreSQL nghẽn khi flash sale; chỉ Redis thì không an toàn khi Redis lỗi.
```

Sau 6 tuần bạn có ~30 mục: đó chính là xương sống của phần trình bày và trả lời phản biện.

---

## 8. Dùng agent để hiểu, không chỉ để làm

Dán trong phiên của task (hoặc phiên mới trỏ tới nhánh):

**Giải thích luồng**

```text
Giải thích luồng xử lý của <tính năng> cho người mới, từ request HTTP tới khi dữ liệu nằm trong DB và sự kiện lên Kafka.
Vẽ sequence bằng Mermaid, và với mỗi bước chỉ rõ file:dòng trong code. Dùng một ví dụ cụ thể có số liệu.
```

**Giải thích điểm khó**

```text
Giải thích đoạn <file:dòng> như thể tôi chưa từng viết Redis/Lua. Nêu: nó làm gì, nếu bỏ nó đi thì lỗi nào xảy ra,
cho một kịch bản hai người dùng cùng lúc làm lộ ra lỗi đó.
```

**Đóng vai hội đồng**

```text
Đóng vai giảng viên phản biện đồ án này. Dựa trên task <T-xxx> và docs/adr, đặt 5 câu hỏi khó nhất về thiết kế
(tính đúng đắn, hiệu năng, đánh đổi). Hỏi từng câu một, chờ tôi trả lời, rồi chấm điểm câu trả lời: đúng/thiếu/sai và vì sao.
```

**Tự kiểm tra**

```text
Ra cho tôi 5 câu hỏi trắc nghiệm về những điểm dễ hiểu sai trong task <T-xxx> (race condition, idempotency, đánh đổi).
Không nêu đáp án; chờ tôi trả lời rồi giải thích.
```

Lưu ý: agent giải thích sai vẫn có thể rất thuyết phục. Với điểm then chốt, **đối chiếu với code và test chạy thật**, đừng chỉ tin lời giải thích.

---

## 9. Khi agent đi chệch

| Triệu chứng                              | Phản ứng (câu nhắc mẫu)                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bỏ qua quy trình, code ngay              | _"Dừng. Đọc lại AGENTS.md mục 2. Tạo run report với phần Kế hoạch, tóm tắt 10 dòng rồi chờ tôi OK."_                                                          |
| Làm thêm ngoài task                      | _"Hoàn tác phần ngoài phạm vi (liệt kê). Chỉ giữ đúng đặc tả T-xxx. Phần thêm hãy ghi thành đề xuất trong run report."_                                       |
| Sửa/skip test để pass                    | _"Khôi phục test về như cũ. Test fail nghĩa là code sai hoặc hiểu sai đặc tả: tìm nguyên nhân gốc, nếu cần hãy hỏi tôi."_                                     |
| Báo "đã pass" nhưng không có số liệu     | _"Chạy lại và dán đầu ra thật của từng lệnh vào run report mục 5."_                                                                                           |
| Tự quyết hợp đồng                        | _"Dừng, đây là điều kiện dừng mục 9.2. Nêu các lựa chọn và đề xuất, chờ tôi quyết."_                                                                          |
| Lặp lại cùng một lỗi                     | _"Dừng. Tóm tắt: đã thử gì, kết quả, giả thuyết còn lại. Chưa sửa nữa cho tới khi tôi trả lời."_                                                              |
| Phiên chat quá dài, bắt đầu quên quy ước | Kết thúc phiên: bảo nó cập nhật run report, commit. Mở phiên mới: _"Đọc AGENTS.md, docs/agent/runs/T-xxx.md và git log nhánh này, rồi tiếp tục từ chỗ dừng."_ |
| Muốn đổi hướng giữa chừng                | Ghi quyết định vào run report (mục 4) để không mất; đổi đặc tả trong `TUAN_PLAN.md` bằng một commit riêng                                                     |

---

## 10. Nhịp làm việc của bạn

**Mỗi ngày:** đầu ngày `STATUS.md` + `git pull`; giao 1 task (hoặc duyệt 1 PR); cuối ngày cập nhật `STATUS.md`, viết sổ bảo vệ.

**Mỗi tuần:** thứ Hai planning (xem TUAN_PLAN tuần đó, mở rộng đặc tả nếu cần); thứ Tư sync hợp đồng; thứ Sáu demo + retro. Mỗi thứ Sáu hỏi: _"Agent làm sai ở đâu tuần này, cần sửa AGENTS.md thế nào?"_ và cập nhật quy ước: `AGENTS.md` là tài liệu sống.

**Với Sơn và Vũ:** gửi họ link `AGENTS.md`, `docs/agent/RUN_REPORT_TEMPLATE.md` và mục 5 của sổ tay này. Review chéo mã lõi theo bảng ở mục 3. Họ cũng nên dùng cùng quy trình và cùng cơ chế "phá thử".

---

## 11. Checklist một trang

**Trước khi giao:** main sạch · `make verify` xanh · STATUS: phụ thuộc Done · phiên chat mới
**Cổng 1:** tóm tắt đúng mục tiêu · file hợp lý · giả định không đụng hợp đồng · thư viện mới đã cân nhắc · có ca test khó
**Khi nhận báo cáo:** số liệu thật · "chưa chạy" đã ghi rõ · số test không giảm · `git diff --stat` đúng phạm vi · grep "mùi" sạch
**Kiểm tra:** chạy lại trên máy · phá thử làm test đỏ · nhìn dữ liệu thật (Redis/psql/Kafka UI)
**Đọc code:** test → SQL/hợp đồng/Lua → logic → nối dây · mã lõi có người thứ hai đọc
**Hiểu:** trả lời được 3 câu của mục 7.4 · ghi 3 dòng vào sổ bảo vệ
**Merge:** squash · STATUS → Done · task kế tiếp ở phiên mới
