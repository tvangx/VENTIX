import { isAxiosError } from "axios";
import { toProblem } from "@/lib/api";

const MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: "Email hoặc mật khẩu chưa đúng.",
  EMAIL_EXISTS: "Email này đã có tài khoản. Hãy đăng nhập.",
  VALIDATION_FAILED: "Thông tin chưa hợp lệ. Kiểm tra lại email và mật khẩu.",
  IDEMPOTENCY_KEY_REUSED: "Yêu cầu bị trùng. Hãy gửi lại.",
  INVALID_REFRESH_TOKEN: "Phiên đăng nhập đã hết. Hãy đăng nhập lại.",
  OAUTH_STATE_INVALID: "Phiên đăng nhập Google đã hết hạn. Hãy thử lại.",
  ACCOUNT_LINK_REQUIRED:
    "Email này đã có tài khoản. Đăng nhập bằng email trước rồi liên kết Google.",
  GOOGLE_NOT_CONFIGURED: "Đăng nhập Google chưa được bật.",
  GOOGLE_UNAVAILABLE: "Google đang không phản hồi. Thử lại sau.",
  GOOGLE_EXCHANGE_FAILED: "Không hoàn tất được đăng nhập Google. Thử lại sau.",
  GOOGLE_TOKEN_INVALID: "Không hoàn tất được đăng nhập Google. Thử lại sau.",
  GOOGLE_ACCOUNT_UNAVAILABLE: "Tài khoản Google này không dùng được để đăng nhập.",
  ORIGIN_FORBIDDEN: "Trang này không được phép đăng nhập vào hệ thống.",
};

export const NETWORK_ERROR_MESSAGE = "Không kết nối được máy chủ. Thử lại sau.";
const FALLBACK_MESSAGE = "Có lỗi xảy ra. Thử lại sau.";

/**
 * Đổi lỗi API thành câu tiếng Việt cho người dùng. Không hiện `detail` của backend vì có thể
 * là thông tin kỹ thuật hoặc tiếng Anh.
 */
export function authErrorMessage(error: unknown): string {
  const problem = toProblem(error);
  if (problem) {
    const known = MESSAGES[problem.code];
    if (known) return known;
    if (problem.status === 429) return "Bạn thử quá nhiều lần. Đợi một lát rồi thử lại.";
    return FALLBACK_MESSAGE;
  }
  if (isAxiosError(error) && (!error.response || error.response.status >= 500)) {
    return NETWORK_ERROR_MESSAGE;
  }
  return FALLBACK_MESSAGE;
}
