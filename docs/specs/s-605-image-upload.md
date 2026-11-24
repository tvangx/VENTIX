# Đặc tả S-605 — Upload ảnh dùng chung (presign, confirm, WebP/thumbnail)

> Trạng thái: **đề xuất, chờ Tuấn chốt hai câu hỏi mở ở mục 9** trước khi cài đặt. Người làm: Sơn. Run report: [S-605](../agent/runs/S-605.md).

## 1. Mục tiêu và phạm vi

Cho Organizer tải ảnh banner sự kiện lên MinIO, lưu `banner_key` đã được kiểm chứng và trả URL công khai cho catalog. Tách phần lưu trữ S3/MinIO của S-105 thành module dùng lại được, giữ tách bạch bucket public (banner) và bucket private (giấy tờ).

Trong phạm vi: presign + confirm cho banner event (`services/event`), xử lý ảnh bằng `sharp`, URL ảnh công khai trong catalog (S-204), module storage dùng chung.
Ngoài phạm vi: ảnh merch (`merch-images`, thuộc Vũ/V-30x), ảnh NFT metadata (S-502, dùng Pinata), upload giấy phép Organizer (giữ luồng qua backend của S-105, chỉ đổi sang module dùng chung nếu không đổi hành vi).

## 2. Phụ thuộc

| Task  | Cần gì                                                                         | Trạng thái (theo STATUS/SON_STATUS)     |
| ----- | ------------------------------------------------------------------------------ | --------------------------------------- |
| S-105 | `DocumentsStorage` (AWS SDK v3 trỏ MinIO), env `MINIO_*`, kiểm tra magic bytes | Done                                    |
| S-201 | CRUD event có `banner_key`, kiểm tra tenant Organizer                          | Done                                    |
| S-204 | Catalog công khai, Redis cache-aside, ETag                                     | Done (phần V-201 bổ sung In review #94) |
| S-504 | Quy tắc mã hóa/bucket (đối chiếu, không chặn)                                  | In review                               |

Hạ tầng đã có: compose tạo sẵn bucket `event-banners`, `organizer-docs`, `merch-images` (`infra/compose/docker-compose.yml`, service `minio-init`).

## 3. Bucket và chính sách truy cập

| Bucket           | Nội dung           | Truy cập                                                         | Ghi chú                                                          |
| ---------------- | ------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `event-banners`  | banner, thumbnail  | **đọc công khai** theo prefix `public/` (đề xuất, xem câu hỏi 2) | Ghi chỉ qua presign hoặc backend; không bao giờ để ghi công khai |
| `organizer-docs` | giấy phép, giấy tờ | **private**                                                      | Chỉ presigned GET ngắn hạn cho owner/Admin (S-105)               |
| `merch-images`   | ảnh merch          | ngoài phạm vi                                                    | Vũ quyết định                                                    |

Object key ảnh banner: `public/events/{eventId}/{uuid}.webp` và `public/events/{eventId}/{uuid}_thumb.webp`. Key do server sinh, không tin tên file hay đường dẫn từ client. Upload ban đầu vào `staging/events/{eventId}/{uploadId}` (không công khai); chỉ confirm thành công mới tạo bản `public/`.

## 4. API (service `event`)

Cả hai endpoint nằm dưới tenant Organizer sở hữu event; Organizer A không thao tác được event của B (cùng guard như S-201).

### 4.1 `POST /v1/organizer/events/{eventId}/banner/presign`

Yêu cầu: `{ "content_type": "image/jpeg|image/png|image/webp", "size_bytes": <int> }`. Header `Idempotency-Key` (UUID).
Kiểm tra: event thuộc tenant, trạng thái cho phép sửa theo BR-02.4, `size_bytes` ≤ `UPLOAD_MAX_BYTES` (đề xuất 5 MiB), MIME nằm trong danh sách.
Phản hồi `201`: `{ "upload_id": uuid, "method": "PUT", "url": "<presigned>", "headers": {"Content-Type": "..."}, "expires_at": ISO8601 }`. URL hết hạn sau `UPLOAD_PRESIGN_TTL_SECONDS` (đề xuất 300). Gọi lại cùng `Idempotency-Key` trả cùng `upload_id`.
Presigned PUT ràng buộc `Content-Type` và `Content-Length`.

### 4.2 `POST /v1/organizer/events/{eventId}/banner/confirm`

Yêu cầu: `{ "upload_id": uuid }`. Header `Idempotency-Key`.
Xử lý:

1. `HeadObject` object staging: phải tồn tại, kích thước ≤ giới hạn, `ContentType` khớp.
2. Đọc byte đầu, kiểm tra magic bytes (JPEG/PNG/WebP), từ chối sai định dạng dù MIME khai báo đúng.
3. `sharp`: xoay theo EXIF, bỏ metadata, giới hạn cạnh dài (đề xuất 1920 px), xuất WebP và thumbnail (đề xuất 480 px). Giới hạn `limitInputPixels` để chống decompression bomb.
4. Ghi hai object vào `public/events/...`, cập nhật `banner_key` của event bằng cập nhật có điều kiện (tenant + version), xóa object staging.
   Phản hồi `200`: `{ "banner_key": "...", "banner_url": "...", "thumbnail_url": "..." }`. Confirm lặp cùng `upload_id` trả lại kết quả cũ, không xử lý lại.
   Lỗi trả `application/problem+json` (`UPLOAD_NOT_FOUND`, `UPLOAD_EXPIRED`, `INVALID_IMAGE_TYPE`, `IMAGE_TOO_LARGE`).

### 4.3 Catalog công khai (S-204)

Phản hồi danh sách/chi tiết bổ sung `banner_url` và `thumbnail_url` (null nếu chưa có ảnh), suy ra từ `banner_key` và `PUBLIC_ASSET_BASE_URL`. Khóa `seed/banners/*` giữ hành vi hiện tại của V-201. Đổi banner phải vô hiệu cache Redis và đổi ETag của event.

## 5. Bảng theo dõi upload

Bảng `image_uploads` trong `event_db` (không đụng DB service khác): `upload_id`, `event_id`, `organizer_id`, `staging_key`, `status` (`PENDING|CONFIRMED|EXPIRED`), `content_type`, `size_bytes`, `expires_at`, `confirmed_at`. Chuyển trạng thái bằng `UPDATE ... WHERE status='PENDING'`. Job dọn: xóa staging quá hạn và bản ghi `EXPIRED` (xử lý object mồ côi mà S-105 đã ghi nhận). Migration dùng `--create-only` rồi sửa tay SQL. Ghi `banner_key` và phát `EventUpdated` (nếu banner thuộc payload hợp đồng) qua Outbox cùng transaction; nếu payload không có banner thì không phát.

## 6. Module dùng chung

Tách logic S3 của `DocumentsStorage` (client, presign PUT/GET, HeadObject, validate magic bytes) thành module nội bộ. Hai lựa chọn: sao chép mẫu vào `services/event` (không chạm vùng Tuấn), hoặc đưa vào `packages/*` (**vùng của Tuấn**, chỉ đề xuất). Đề xuất: giai đoạn 1 sao chép vào `services/event`, giai đoạn 2 đề xuất Tuấn tách package khi có service thứ ba cần.

## 7. Cấu hình

Biến mới trong `services/event/.env.example` và schema zod (đọc đủ cặp khóa như identity): `S3_ENDPOINT`, `S3_REGION` (mặc định `us-east-1`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE=true`, `BANNER_BUCKET=event-banners`, `PUBLIC_ASSET_BASE_URL`, `UPLOAD_MAX_BYTES`, `UPLOAD_PRESIGN_TTL_SECONDS`. Không hardcode khóa, không log URL presigned.
Thư viện mới: `@aws-sdk/client-s3` và `@aws-sdk/s3-request-presigner` đã được identity dùng; `sharp` (Apache-2.0) cần nêu lý do theo CONVENTIONS mục 8 và kiểm tra build trên Node 20 Windows/Linux.

## 8. Test và DoD

Test bắt buộc: unit (magic bytes, MIME sai, vượt kích thước, idempotency key), integration với PostgreSQL + MinIO thật (presign→PUT→confirm, replay confirm, upload hết hạn, event của tenant khác bị 403/404, file giả mạo đuôi, ảnh quá lớn), concurrency (50 confirm cùng `upload_id` chỉ xử lý một lần), catalog trả URL và đổi ETag khi đổi banner. Kiểm chứng gồm `lint`, `typecheck`, `test`, `test:int`, `test:conc` của `event`, `openapi:export`, `pnpm format:check && pnpm build`.
DoD: Organizer tải banner qua hai bước và thấy ảnh trong catalog; ảnh giả mạo bị từ chối; object staging được dọn; OpenAPI, README event, ERD/sequence cập nhật; run report có số test thật; không có secret; MinIO thật được kiểm chứng (S-105 từng chưa chạy được do Docker).

## 9. Câu hỏi mở (chặn cài đặt)

1. **CONTRACT CHANGE — OpenAPI của `event`.** Hai endpoint mới và hai trường `banner_url`/`thumbnail_url` là thay đổi additive trên hợp đồng đã bàn giao cho Vũ. _Lựa chọn:_ (A) thêm vào OpenAPI hiện tại, additive, không đổi trường cũ; (B) làm service/route riêng để không đụng hợp đồng event. _Đề xuất:_ A, vì chỉ thêm, Vũ sinh lại client; cần Tuấn xác nhận và báo Vũ. _Nếu chọn sai:_ FE hỏng build hoặc phải làm lại client.
2. **Banner đọc công khai trực tiếp từ MinIO hay qua Kong.** _(A)_ bucket `event-banners` public-read prefix `public/`, URL trực tiếp: đơn giản, nhanh, nhưng lộ endpoint MinIO và khó thêm cache/CDN sau. _(B)_ qua Kong `/assets/*` proxy tới MinIO: một origin, cache header và rate limit ở Kong, nhưng thêm route Kong (vùng Tuấn) và tải qua gateway. _Đề xuất:_ A cho dev và giai đoạn đầu, giữ `PUBLIC_ASSET_BASE_URL` để chuyển sang B không đổi code. _Nếu chọn sai:_ đổi URL ảnh đã lưu, nhưng vì DB chỉ lưu `banner_key` nên chi phí thấp.

## 10. Giả định

- Giới hạn 5 MiB, cạnh dài 1920 px, thumbnail 480 px, TTL presign 300 giây là giá trị khởi điểm, chỉnh được bằng env.
- Chỉ Organizer sở hữu event được đổi banner; Admin không upload hộ.
- Một banner mỗi event; ảnh gallery ngoài phạm vi.
- Compose dev chưa đặt policy public-read cho bucket; việc thêm `mc anonymous set` vào `minio-init` thuộc `infra/` (vùng Tuấn) nên chỉ đề xuất.
