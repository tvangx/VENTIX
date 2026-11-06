# Nhật ký câu hỏi và thay đổi — Sơn, tuần 2

Phạm vi: S-201–S-206. Người giao: Sơn. Bắt đầu ngày 2026-10-25.

Review tài liệu: [draft PR #44](https://github.com/tvangx/VENTIX/pull/44),
nhánh `feat/event-s201-crud`. PR chỉ công bố nhật ký và run report; chưa cài đặt CRUD.

Nhật ký này giúp người và AI review truy ngược từ implementation về yêu cầu,
nguồn tài liệu và quyết định trong chat. Run report của mỗi task phải liên kết
đến các mục liên quan ở đây. Không tự sửa tài liệu gốc trên Drive.

## Cách duy trì

- Mỗi câu hỏi hoặc điểm lệch có ID cố định; ghi task, ngày, câu hỏi, lựa chọn,
  câu trả lời thực tế, nguồn, quyết định, tác động và phần cần cập nhật tài liệu.
- Phân biệt **đã chốt**, **đề xuất**, **chưa chốt**, **đã cài đặt** và **đã kiểm chứng**.
  Việc Sơn đồng ý một hướng không có nghĩa mọi chi tiết kỹ thuật đã được duyệt,
  code đã tồn tại, test đã pass hoặc PR đã merge.
- Giữ lịch sử đề xuất cũ và lý do thay đổi; khi sửa quyết định, thêm diễn biến,
  không xóa nội dung cũ làm mất dấu vết.
- Ghi riêng điểm lệch so với tài liệu gốc, điểm thiếu trong thiết kế repo và
  việc agent thay đổi đề xuất của chính mình.
- Khi triển khai, bổ sung file/migration/commit/test liên quan vào đúng mục.
  Khi tài liệu gốc được sửa, ghi người sửa, ngày và liên kết phiên bản xác minh.

## Q-S201-01 — Ai quản lý venue?

- **Task:** S-201.
- **Ngày:** 2026-10-25.
- **Trạng thái quyết định:** Đã chốt hướng venue theo tenant từ phản hồi của Sơn.
- **Trạng thái cài đặt:** Chưa cài đặt; chưa có migration hoặc test ownership mới.

### Câu hỏi đã gửi

> Venue hiện là danh mục chung, không có organizer_id. Sơn chọn quyền CRUD nào?
> AGENTS.md mục 9.4 yêu cầu chốt chính sách trước khi triển khai; cho mọi
> Organizer sửa danh mục chung sẽ ảnh hưởng event của tenant khác.

Các lựa chọn lúc hỏi:

1. Admin tạo/sửa/xóa; Organizer chỉ đọc và chọn venue — agent đề xuất ban đầu
   nhằm giữ schema S-107 hiện tại.
2. Venue thuộc từng Organizer; thêm organizer_id và migration trong event-service.

**Đính chính cách đặt câu hỏi:** schema S-107 thiếu organizer_id chỉ chứng minh
ownership chưa được biểu diễn, không chứng minh nghiệp vụ đã chốt venue là
danh mục dùng chung. Cụm “hiện là danh mục chung” trong câu hỏi là suy luận ban
đầu của agent và đã được điều chỉnh sau nghiên cứu.

### Phản hồi và diễn biến

1. Sơn cung cấp [sheet SRA-VENTIX](https://docs.google.com/spreadsheets/d/14sELH9ZL6LIK29FnURvD8KPpzNuhsTlaDrryrxCrC2M/edit)
   và yêu cầu: “thử research các tài liệu trong sheet này xem, nên chọn ý nào”.
2. Agent đọc tài liệu liên kết, đổi đề xuất sang lựa chọn 2 và báo rõ lý do.
3. Sơn phản hồi: “ok, nhưng cần log lại những câu hỏi và thay đổi so với tài liệu
   bàn đầu để sau tôi hoặc AI review để sửa lại”. Phản hồi này xác nhận hướng
   venue theo tenant và yêu cầu lưu dấu vết; không coi là ủy quyền tự sửa mọi
   chính sách còn thiếu hoặc tự sửa tài liệu gốc trên Drive.

### Nguồn và đối chiếu

| Nguồn                                                                                                                                              | Nội dung xác minh                                                                 | Đối chiếu                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Đặc tả yêu cầu](https://docs.google.com/document/d/1v7qOPtiUM8c46NEwFZDYYQ63CB0Y1vDuD7IB_kZBHyI/edit), III.1.4 và FR-EVENT-004                    | Organizer chỉ quản lý dữ liệu thuộc tenant; actor của Quản lý venue là ORGANIZER. | Hỗ trợ Organizer quản lý venue trong tenant.                            |
| [UC-04](https://docs.google.com/document/d/1sL16iT1i_q1jONa7eY9iEFgjpCmlvclW1_l1ybZCuOU/edit), luồng chính bước 2                                  | Organizer tạo venue hoặc chọn venue có sẵn.                                       | Admin độc quyền CRUD sẽ không đáp ứng luồng tạo venue.                  |
| [Activity UC-04](https://docs.google.com/document/d/1hijYwmP24GMBDdu8Y9UcvknLPrPy4-i3KdVPthXeang/edit), bước 3                                     | Organizer chọn hoặc tạo venue với tên, sức chứa, địa chỉ.                         | Củng cố luồng tự cấu hình của Organizer.                                |
| [ERD gốc](https://docs.google.com/document/d/1pM0R95pWq7ZbRZ2247uAletMNrOvPvAE/edit), mục 3 và 4                                                   | Một Organizer quản lý nhiều venue; venues có organizer_id.                        | Ownership đã xuất hiện trong tài liệu nghiệp vụ/ERD.                    |
| [Kiến trúc v2 trong repo](../architecture/architecture-v2.md), mục 5.2; [schema S-107](../../services/event/prisma/schema.prisma) tại base ef31216 | Venues chỉ có thông tin địa điểm và version; không có organizer_id.               | Thiếu ownership so với yêu cầu/ERD gốc; cần bổ sung bằng migration mới. |

### Quyết định và tác động dự kiến

- Venue thuộc Organizer; Organizer chỉ quản lý và chọn venue trong tenant của mình.
- Dùng organizer_id của tenant, không dùng user_id làm định danh Organizer.
- Đề xuất kỹ thuật: thêm venues.organizer_id, unique (id, organizer_id) và FK
  ghép events(venue_id, organizer_id) → venues(id, organizer_id) để chặn tham
  chiếu khác tenant. Tất cả nằm trong event_db.
- Không mang FK organizer_id → users của ERD cũ sang kiến trúc hiện tại:
  Identity và Event có DB riêng; identity_db chỉ được tham chiếu bằng ID.
- “Chọn venue có sẵn” được hiểu trong tenant hiện tại. Chia sẻ venue giữa
  các tenant cần chính sách riêng; chưa nằm trong quyết định này.
- Không sửa migration S-107 đã công bố. Backfill dữ liệu cũ không xác định
  được tenant phải báo lỗi rõ và chờ mapping, không tự gán hoặc xóa dữ liệu.

### Những gì thay đổi và việc review sau

- **So với yêu cầu/ERD gốc:** hướng ownership được giữ; cách tham chiếu Identity
  chuyển từ mô hình FK users cũ sang ID tenant theo database-per-service.
- **So với kiến trúc v2/schema S-107:** bổ sung ownership còn thiếu và ràng buộc
  cùng tenant. Cần cập nhật ERD Event, README và tài liệu kỹ thuật liên quan
  cùng implementation; việc sửa tài liệu kiến trúc dùng chung phải theo ownership.
- **So với đề xuất đầu của agent:** bỏ hướng Admin độc quyền CRUD venue.
- **Cần review:** migration, backfill, FK ghép, không rò venue tenant khác,
  event không gắn venue tenant khác, không dùng FK/DB Identity.
- **Bằng chứng implementation/test:** chưa có; các test nền trong run report
  S-201 không phải bằng chứng cho quyết định này đã được cài đặt.

## Q-S201-02 — Cho sửa event ở trạng thái nào?

- **Task:** S-201; ảnh hưởng luồng duyệt S-203.
- **Ngày:** 2026-10-25.
- **Trạng thái:** Nguyên tắc tìm thấy trong tài liệu; chi tiết triển khai chưa chốt.
- **Trạng thái cài đặt:** Chưa cài đặt.

### Câu hỏi đã gửi

> Event, ticket class và sale phase được sửa/xóa ở trạng thái nào? Đề xuất chỉ
> DRAFT/REJECTED; PENDING trở đi khóa CRUD, chuyển trạng thái qua S-203 để tránh
> sửa dữ liệu đã duyệt hoặc đã bán.

Các lựa chọn lúc hỏi: chỉ DRAFT/REJECTED, hoặc cho sửa sau duyệt và chốt danh
sách trường cùng quy trình duyệt lại. Chưa có câu trả lời chọn cụ thể hai
phương án này. Không suy diễn phản hồi “ok” thành một ma trận quyền sửa đầy đủ.

### Nguồn và kết quả nghiên cứu

- [Quy trình nghiệp vụ](https://docs.google.com/document/d/1mLP4CD5lUTl869-w-CMAOqmJe3iqQCKJS0wOy1waLgU/edit),
  BR-02.4: được sửa trước mở bán; sau mở bán chỉ sửa thông tin không ảnh hưởng
  đến vé đã bán.
- [UC-03](https://docs.google.com/document/d/1sL16iT1i_q1jONa7eY9iEFgjpCmlvclW1_l1ybZCuOU/edit):
  thay thời gian/địa điểm sau mở bán cần ghi lịch sử và thông báo người dùng.
  UC-05 yêu cầu Admin duyệt trước khi public và có luồng yêu cầu bổ sung.
- Kiến trúc v2 mục 5.2: seat map đã publish bất biến; sửa phải tạo version mới
  và chỉ cho phép trước mở bán.

### Điểm lệch và phần còn mở

- Khóa mọi CRUD từ PENDING trở đi là **đề xuất ban đầu của agent**, chặt hơn
  BR-02.4; không phải yêu cầu đã duyệt và chưa được cài đặt.
- Phải phân biệt trạng thái duyệt, trạng thái public và mốc mở bán; không coi
  APPROVED/PUBLISHED tự động đồng nghĩa đã mở bán.
- Chưa chốt danh sách trường được sửa sau duyệt/mở bán, cách duyệt lại khi
  thay nội dung quan trọng, và cơ chế đồng bộ/audit/thông báo tương ứng.
- Các thao tác đổi giá/quota/sale phase sau khi có đơn hoặc vé cần chính sách
  rõ ràng; không coi là chi tiết kỹ thuật nhỏ mà agent tự chọn.
- Nếu chỉ làm DRAFT/REJECTED trong S-201, phải ghi đây là phạm vi thu hẹp cần
  được chốt, nêu phần còn thiếu theo BR-02.4 và không báo hoàn thành toàn bộ.
- **Hành động review:** Sơn chốt chính sách còn mở trước khi cài đặt logic phụ
  thuộc; sau đó cập nhật ma trận trạng thái/trường, test và tài liệu tương ứng.

## O-S203-01 — Seat map version trong hợp đồng Kafka

- **Task liên quan:** S-203/S-206; ghi nhận khi đọc nền S-201, chưa bắt đầu task.
- **Trạng thái:** Quan sát cần kiểm tra khi tới S-203; chưa hỏi, chưa có quyết định,
  chưa thay hợp đồng.
- ADR-0010 mô tả Booking phát hiện seat_map_version mới từ EventApproved/Updated,
  nhưng schema hai sự kiện trong event-contracts tại base ef31216 không có trường đó.
- Khi tới task, phải đối chiếu hợp đồng mới nhất và ghi đề xuất cụ thể nếu cần
  CONTRACT CHANGE; không tự sửa shared package hoặc coi nhật ký này là phê duyệt.

## Chỉ mục run report và implementation

| Task        | Run report                | Quyết định/quan sát liên quan         | Implementation tại thời điểm ghi                                    |
| ----------- | ------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| S-201       | [S-201.md](runs/S-201.md) | Q-S201-01, Q-S201-02                  | Chuẩn bị worktree, test nền, nghiên cứu và nhật ký; chưa code CRUD. |
| S-202–S-206 | Chưa tạo                  | O-S203-01 cần kiểm tra khi tới S-203. | Chưa bắt đầu.                                                       |
