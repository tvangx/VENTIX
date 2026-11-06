# Kong dev — T-206

Kong OSS 3.8 DB-less đảm nhiệm routing, CORS, request-id, giới hạn body và rate limit. JWT và admission token được verify trong service theo ADR-0004. API nội bộ gọi trực tiếp giữa các service trong mạng nội bộ (ADR-0010).

## Hạn mức đề xuất

Mọi hạn mức theo IP/phút, policy `local`:

| Route                                       |  Dev | Load test local |
| ------------------------------------------- | ---: | --------------: |
| `/api/booking/v1/holds` (cả đường con)      |   60 |          600000 |
| `/api/booking/v1/checkout` (cả đường con)   |   20 |          600000 |
| `/api/booking/v1/queue/join` (cả đường con) |   30 |          600000 |
| Identity                                    |  120 |          600000 |
| Mặc định từng service còn lại               | 1200 |          600000 |

Đây là đề xuất khởi đầu, chưa phải năng lực đo được. Checkout chặt hơn vì ghi DB; holds cho phép đổi lựa chọn ghế; queue join cần ít lần thử hơn holds. Người dùng chung NAT chia sẻ quota. `local` dùng bộ đếm trong từng Kong node, không phải giới hạn toàn cụm; restart Kong xóa counter. Không tin `X-Forwarded-For` do client gửi và không bật trusted proxy trong task này.

Chỉnh `config.minute` của plugin trong `kong.yml` rồi `make kong-reload`. Kong validate số và schema khi nạp. Không có bước nội suy biến môi trường. Nếu thay quota dev, chạy smoke test với các giá trị tương ứng, ví dụ `bash scripts/check-kong.sh 60 20 30` (giới hạn 1000 để không vô tình flood bản load test).

## Routing và chặn internal

- Route độc lập `block-internal` khớp `~/(?i:api/[^/]+/v1/internal)`, không gắn service, không giới hạn host/method, `regex_priority: 1000`. Khớp cả `internal` lẫn `internal*`, bao gồm service chưa được khai báo. Không phân biệt hoa thường vì Express mặc định cũng không phân biệt; đổi sang `V1/INTERNAL` không né được rào.
- `request-termination` trả 404 JSON `{"message":"Not found"}`. CORS riêng có `preflight_continue: true` để OPTIONS cũng tới plugin trả 404.
- Rate limit và body limit 2 MiB đặt ở service public thay vì global. Route internal không chịu hai plugin này nên vẫn trả 404 khi client đã hết quota hoặc body lớn. Fallback 1200/phút hiện là **theo service**, thay vì bucket global trước đây.
- Route nóng có priority 100 và regex lookahead: chỉ phần `/api/booking` bị strip, giữ nguyên `/v1/...`, đường con và query cho booking. Boundary `/|$` tránh khớp `/holds-other`.
- Compose đặt `KONG_ROUTER_FLAVOR=traditional`: router `traditional_compat` mặc định trong 3.8 dùng Rust regex, không hỗ trợ lookahead. Lần đầu áp dụng cần `make up` để recreate Kong với cấu hình router.
- Không thêm tiêu chí method/host vào public route mà chưa kiểm tra lại ưu tiên internal. Cấu hình load test giữ nguyên rào internal, CORS, request-id và body limit; chỉ nới `minute`.

Tham khảo chính thức: [thứ tự route traditional](https://developer.konghq.com/gateway/routing/traditional/), [strip_path](https://developer.konghq.com/gateway/entities/route/), [rate limiting](https://developer.konghq.com/plugins/rate-limiting/). Hành vi phiên bản 3.8 phải được kiểm tra bằng curl thật, không chỉ dựa vào tài liệu.

## Chạy và khôi phục

```bash
make up
make verify
make kong-reload
bash scripts/check-kong.sh
make kong-loadtest
# Chạy k6 local khi sẵn sàng; không dùng cấu hình này cho prod.
make kong-reload
bash scripts/check-kong.sh
pnpm format:check
pnpm build
```

`make kong-loadtest` POST file load test tới Admin API **localhost:8001**; không ghi đè `kong.yml`, không mount thêm file, không restart hạ tầng. `make kong-reload` restart Kong và khôi phục cấu hình dev từ file mount. Restart sau đó cũng trở về dev. Admin API chỉ bind loopback trong compose; không mở ra ngoài.

Smoke test không cần service nghiệp vụ đang chạy: kiểm tra phản hồi do gateway tạo và header quota, chấp nhận upstream 502 khi service chưa khởi động. Test gửi POST không token với `{}` để không tạo tài nguyên hợp lệ. Bằng chứng đường dẫn upstream và trạng thái auth của service thật cần kiểm tra riêng; xem run report T-206. Script thoát khác 0 ngay khi sai, in tổng số check thật khi hoàn tất; tự đặt `MSYS_NO_PATHCONV=1` và chuyển đường dẫn file tạm cho curl.exe trên Git Bash.
