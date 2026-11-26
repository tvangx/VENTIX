import { isAxiosError } from "axios";
import { toProblem } from "@/lib/api";

// Mã lỗi của event-service (organizer) → câu tiếng Việt cho người tổ chức.
const MESSAGES: Record<string, string> = {
  VERSION_CONFLICT:
    "Dữ liệu vừa được thay đổi ở nơi khác. Đã tải bản mới nhất, kiểm tra rồi lưu lại.",
  EVENT_NOT_EDITABLE: "Sự kiện đã gửi duyệt nên không sửa được nữa.",
  EVENT_TRANSITION_NOT_ALLOWED: "Sự kiện không ở trạng thái gửi duyệt được.",
  RESOURCE_CONFLICT: "Tên hạng vé đã có trong sự kiện này. Đặt tên khác.",
  RESOURCE_IN_USE: "Hạng vé đang có trong sơ đồ ghế. Sửa sơ đồ ghế trước rồi xóa.",
  INVALID_TIME_RANGE: "Thời điểm kết thúc phải sau thời điểm bắt đầu.",
  INVALID_SEAT_CLASS: "Sơ đồ ghế chỉ dùng được hạng vé có chỗ ngồi của sự kiện này.",
  INVALID_SEAT_MAP: "Sơ đồ không hợp lệ.",
  INVALID_GA_CLASS: "Khu đứng chỉ gắn được với hạng vé đứng của sự kiện này.",
  DUPLICATE_GA_CLASS: "Mỗi hạng vé đứng chỉ gắn với một khu đứng.",
  DUPLICATE_SEAT_MAP_LABEL: "Tên block, khu, hàng hoặc khu đứng bị trùng.",
  SEAT_MAP_CLASS_MISMATCH: "Sơ đồ chưa khớp hạng vé. Sửa sơ đồ rồi lưu lại.",
  NOT_FOUND: "Không tìm thấy dữ liệu, có thể đã bị xóa.",
  TENANT_MISMATCH: "Phiên ban tổ chức đã hết. Tải lại trang để tiếp tục.",
  FORBIDDEN: "Tài khoản không có quyền ban tổ chức.",
  INVALID_IMAGE_TYPE: "Chỉ nhận ảnh JPEG, PNG hoặc WebP.",
  IMAGE_TOO_LARGE: "Ảnh banner vượt dung lượng cho phép (tối đa 5 MB).",
  INVALID_IMAGE_CONTENT: "Tệp không phải ảnh JPEG, PNG hoặc WebP hợp lệ, hoặc ảnh bị hỏng.",
  UPLOAD_NOT_FOUND: "Ảnh chưa tải lên xong hoặc đã hết hạn. Chọn lại ảnh rồi thử lại.",
  STORAGE_NOT_CONFIGURED: "Kho ảnh chưa sẵn sàng. Thử lại sau hoặc gửi duyệt không kèm banner.",
  STORAGE_UNAVAILABLE: "Kho ảnh tạm thời không dùng được. Thử lại sau ít phút.",
};

export function organizerErrorMessage(error: unknown): string {
  const problem = toProblem(error);
  if (problem) return MESSAGES[problem.code] ?? problem.detail ?? "Có lỗi xảy ra, thử lại sau.";
  if (isAxiosError(error) && error.response) {
    return `Máy chủ báo lỗi (HTTP ${error.response.status}). Thử lại sau.`;
  }
  return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
}

export function isVersionConflict(error: unknown): boolean {
  return toProblem(error)?.code === "VERSION_CONFLICT";
}
