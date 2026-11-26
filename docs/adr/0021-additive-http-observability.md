# ADR-0021: Observability HTTP bổ sung độc lập vào stack demo

- **Trạng thái:** Đề xuất triển khai theo phạm vi T-404 được Tuấn duyệt
- **Ngày:** 2026-11-26
- **Liên quan:** T-404, ADR-0018, T-208

## Bối cảnh

Stack demo EC2 8 GiB đã chạy qua Tunnel → Kong; bật giám sát không được thay image/credential/volume/network/trust của app. Metric HTTP cũ tại mỗi service chưa cùng tên/nhãn với spec và đang tính lượt scrape. User đã duyệt thay instrumentation HTTP tại sáu service và dependency prom-client trực tiếp của common; không đổi API nghiệp vụ/Kafka/DB.

## Quyết định

Common cung cấp HttpMetrics dùng histogram `http_server_request_duration_seconds` với service/method/route/status_class. Đăng ký middleware Express global ngay sau NestFactory để đo cả 404 ngoài prefix và guard/filter errors; bỏ middleware HTTP cũ trong module để không đo trùng. Ghi một lần trên response finish; route dùng mẫu đăng ký, không dùng raw URL/baseUrl/ID làm label; bỏ scrape qua originalUrl chỉ dùng làm điều kiện loại trừ. Không song song interceptor vì có thể đếm trùng và bỏ sót lỗi guard/404.

Obs Compose standalone dùng project hiện tại và external network đã có, chỉ quản lý Prometheus/Grafana với hai named volume riêng. Prometheus nối backend internal hiện có và bridge riêng obs-access; Grafana chỉ nối obs-access. Bridge riêng phục vụ port host loopback, vì kiểm tra thực tế internal-only không truy cập được port publish. Không đổi mạng/trust ứng dụng. Prometheus scrape năm backend qua tên DNS container; Grafana provision datasource/RED bằng file. Loopback-only, anonymous off, không Kong/public route/docker.sock/exporters/logs/tracing. File env riêng validate, artifact riêng không chứa script/image app; manifest kiểm ID sau docker save/load. Prometheus LTS 3.13.5, Grafana OSS 13.3.2 từ nguồn chính thức; ghim digest, pull amd64 trước commit.

Giới hạn obs 512+512 MiB, mỗi daemon 0,5 CPU, scrape 15s, retention 7d/1GiB. WAL/head không phải hard disk quota; cần theo dõi headroom máy 40GiB. Dashboard không coi no-data/no-traffic là hệ thống khỏe; scrape availability tách khỏi sự hiện diện metric và RED.

## Hệ quả

- Có thể start/stop/recreate obs mà không nâng app/migration/Tunnel; giữ dữ liệu giữa recreate.
- Backend cũ vẫn có thể scrape thành công nhưng dashboard mới thiếu metric: cần Tuấn duyệt rollout năm backend trước nghiệm thu RED trên EC2. Không có schema/migration mới trong T-404.
- Đổi tên metric là thay đổi truy vấn observability; dashboard ngoài repo cần chuyển thủ công. Các service chưa triển khai ngoài sáu service được duyệt giữ metric cũ tới khi có task chuyển instrumentation riêng.
- Không tự downgrade DB/TSDB giữa phiên bản; rollback cùng phiên bản/config hoặc stop obs nếu chưa xác nhận tương thích.
- Footprint local/smoke không đại diện tải EC2; exporters/Loki/tracing thuộc T-501.
