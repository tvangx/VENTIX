# ADR-0018: Cloudflare Tunnel bằng container, token file và trust IP connector

- **Trạng thái:** Đã chấp nhận phương án (Tuấn duyệt kế hoạch T-207 ngày 2026-11-25; chờ review cài đặt)
- **Ngày:** 2026-11-25
- **Liên quan:** ADR-0008, T-207, PR #47, `docs/ops/vps-setup.md`

## Bối cảnh

Base hạ tầng đã được Tuấn nghiệm thu trên EC2; chưa có domain/tunnel token. Runbook cũ chọn connector trên host. Tuấn chọn container và giao agent chỉ sửa file/kiểm chứng local, giữ base deploy độc lập và dữ liệu hiện có.

## Quyết định

- Thêm Compose overlay tùy chọn, dùng cùng project `ticketing-prod`. Không đổi tên hoặc xóa bảy volume; không đổi password, DB hay hợp đồng nghiệp vụ.
- Dùng image chính thức cloudflare/cloudflared ghim digest qua `CLOUDFLARED_IMAGE`, chỉ commit sau pull thật. Connector chạy nonroot 65532:65532, filesystem chỉ đọc, restart unless-stopped, log rotation, không publish port.
- Token trong file ngoài Git, bind read-only và `--token-file`; không đặt giá trị token trong argv/env/log. Tuấn nhập token, quản trị đặt quyền file deploy:65532 mode 0440; deploy không cần sudo. Image/UID/GID/quyền đọc được test với dữ liệu giả trên Linux.
- Connector có mạng egress riêng và mạng origin internal chỉ nối Kong. Origin `http://kong:8000`; Kong chỉ tin IP connector 172.30.207.2/32, đọc CF-Connecting-IP, recursive off. Mạng mẫu 172.30.207.0/29 cần kiểm tra xung đột trước khi áp dụng; thay subnet phải sửa đồng bộ qua review. Không trust toàn subnet/host/địa chỉ edge Cloudflare.
- Giữ Kong loopback 8000 để kiểm tra local, Admin off và chặn /internal. Data services chỉ ở backend internal; connector không tham gia backend.
- Base không phụ thuộc tunnel/env token; bật tunnel rõ ràng bằng tham số deploy. Compose healthcheck kiểm tra cloudflared ready; HTTPS/DNS/IP thật cần Tuấn nghiệm thu riêng, không suy ra từ health base.

## Phương án đã cân nhắc

- Connector host: cần cài/quản lý service riêng và origin loopback; đã thay bằng lựa chọn container của Tuấn.
- Token qua --token hoặc TUNNEL_TOKEN: thuận tiện nhưng làm lộ giá trị qua process/environment; không dùng.
- Trust toàn mạng Docker: đơn giản nhưng container khác có thể giả IP khách; chỉ trust connector /32 trên mạng riêng.

## Hệ quả

Thêm một daemon tùy chọn và một subnet cố định cần kiểm tra xung đột. Quản trị cần đặt quyền token cho UID/GID image; Docker group có quyền tương đương root nên không bảo vệ token khỏi người có quyền Docker. Worker cùng zone có thể ảnh hưởng CF-Connecting-IP; Tuấn kiểm tra cấu hình Cloudflare và IP thật. Rollback stop connector trước, trả Kong về base và giữ dữ liệu; không tự xoay token/password. Không mở rộng sang hardening toàn hệ thống T-503 hoặc deploy production T-601.
