# Dữ liệu seed nội dung (V-104)

Dữ liệu mẫu dùng chung cho cả nhóm: 5 sự kiện, merch, banner và FAQ. Mọi tên người, ban tổ chức, địa điểm và sự kiện đều **hư cấu**.

| File          | Nội dung                                                                      | Bám theo ERD (`architecture-v2.md`)                      |
| ------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| `venues.json` | 4 địa điểm                                                                    | `event_db.venues` (5.2)                                  |
| `events.json` | 5 sự kiện, mỗi sự kiện kèm `ticket_classes` và `sale_phases`                  | `event_db.events`, `ticket_classes`, `sale_phases` (5.2) |
| `merch.json`  | `categories`, `products`, `skus` (gộp `inventory`), `combos` (kèm `items`)    | `merch_db` (5.7)                                         |
| `faq.json`    | Câu hỏi thường gặp, nhóm theo `category`, sắp xếp theo `order`                | — (nội dung tĩnh của web)                                |
| `schema.ts`   | Schema zod cho các file trên                                                  |                                                          |
| `index.ts`    | Nạp và validate JSON, xuất `seedEvents`, `seedMerch`, `seedVenues`, `seedFaq` |                                                          |

Banner nằm ở `apps/web/public/seed/banners/`. `banner_key` của sự kiện là khóa object (MinIO); khi chạy dev, Vite phục vụ ảnh tại `/<banner_key>` (hàm `bannerUrl`).

## Các sự kiện

| Slug                       | Trạng thái  | Loại vé      | Dùng để demo                                             |
| -------------------------- | ----------- | ------------ | -------------------------------------------------------- |
| `song-am-live-2026`        | `PUBLISHED` | 10.000 ghế   | Flash sale: hàng chờ, KYC, giới hạn vé, 2 đợt bán, combo |
| `gio-mua-festival-2027`    | `PUBLISHED` | Vé đứng (GA) | Vé không chọn chỗ, combo                                 |
| `giao-huong-mua-xuan-2027` | `PUBLISHED` | 500 ghế      | Sự kiện nhỏ, không hàng chờ                              |
| `kich-chuyen-tau-dem`      | `PUBLISHED` | 300 ghế      | Đang mở bán (từ 20/10/2026), không hàng chờ              |
| `neon-pulse-2027`          | `PENDING`   | GA + ghế VIP | Admin duyệt sự kiện; không có merch                      |

SKU `SA26-POSTER-SIGNED` chỉ còn 15 (ngưỡng 10), dùng để demo cảnh báo sắp hết hàng (V-503).

## Quy ước UUID

ID cố định để các seed script phía service dùng lại đúng giá trị. Tiền tố theo loại:

| Tiền tố    | Loại                      | Tiền tố    | Loại     |
| ---------- | ------------------------- | ---------- | -------- |
| `10000000` | organizer (`identity_db`) | `40000000` | category |
| `20000000` | venue                     | `41000000` | product  |
| `30000000` | event                     | `42000000` | sku      |
| `31000000` | ticket class (`…0000EC`)  | `43000000` | combo    |
| `32000000` | sale phase (`…0000EP`)    |            |          |

Với ticket class, sale phase và SKU, hai chữ số cuối là `<số thứ tự cha><số thứ tự con>`, ví dụ ticket class thứ 2 của sự kiện 1 là `31000000-0000-4000-8000-000000000012`.

**Organizer:** `…000000000001` và `…000000000002` chưa tồn tại ở `identity_db`. Seed của identity (S-101/S-104) cần tạo hai organizer với đúng hai ID này.

## Ngoài phạm vi

- Sơ đồ ghế (`seat_maps`, `zones`, `blocks`, `seats`): do script seed của event-service sinh (S-205), dựa trên `capacity` của từng hạng vé ở đây.
- Người dùng, đơn hàng mẫu: V-601.
- FAQ chỉ ghi các chính sách đã chốt trong tài liệu kiến trúc. Chưa có câu trả lời cho: khách tự yêu cầu hoàn vé, giao nhận merch, thời điểm giải ngân escrow.

## Nguồn ảnh

Tất cả ảnh lấy từ [Pexels](https://www.pexels.com/license/): miễn phí, kể cả mục đích thương mại, không bắt buộc ghi nguồn. Giấy phép cấm bán lại ảnh chưa chỉnh sửa và cấm ngụ ý người hoặc thương hiệu trong ảnh bảo trợ sản phẩm.

| File                           | Ảnh gốc                                                                                                                | Tác giả          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `song-am-live-2026.jpg`        | [People at Concert](https://www.pexels.com/photo/people-at-concert-1105666/)                                           | Vishnu R Nair    |
| `gio-mua-festival-2027.jpg`    | [Aerial Footage of Live Concert](https://www.pexels.com/photo/aerial-footage-of-live-concert-7081216/)                 | Bence Szemerey   |
| `giao-huong-mua-xuan-2027.jpg` | [Orchestra Performing on Stage](https://www.pexels.com/photo/orchestra-performing-on-stage-5182979/)                   | King of Concepts |
| `chuyen-tau-dem.jpg`           | [Spotlight on a Red Curtain](https://www.pexels.com/photo/spotlight-on-a-red-curtain-4722571/)                         | cottonbro studio |
| `neon-pulse-2027.jpg`          | [Silhouette Of People In Front Of Stage](https://www.pexels.com/photo/silhouette-of-people-in-front-of-stage-1763067/) | Sebastian Ervi   |

Ảnh đã được cắt về 1600x900 khi tải.
