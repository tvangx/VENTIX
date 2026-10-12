# ADR-0008: Deploy mức product trên VPS với Docker Compose

- **Trạng thái:** Đề xuất (chốt tại workshop T-107, tuần 1)
- **Ngày:** 2026-10-12
- **Người quyết định:** Tuấn, Sơn, Vũ

## Bối cảnh

Tiêu chí chấm ưu tiên sản phẩm chạy thật, chất lượng toàn diện.

## Quyết định

VPS 8–16 GB, Docker Compose, domain + HTTPS qua Cloudflare, CI/CD GitHub Actions, giám sát Prometheus/Grafana/Loki, backup pg_dump + thử restore. k6 chạy từ máy khác.

## Phương án đã cân nhắc

- Kubernetes/k3s (mạnh hơn nhưng tốn thời gian học với team 3 người).

## Hệ quả

- (+) Đủ chứng minh chất lượng vận hành trong 6 tuần. (-) Scale ngang thủ công qua `--scale`.
