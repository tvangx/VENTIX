import { setupWorker } from "msw/browser";
import { restoreMockState } from "./db";
import { handlers } from "./handlers";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Bật mock trong trình duyệt. Request tới service đã mock được MSW trả lời; request khác
 * (ví dụ event-service chưa có OpenAPI, ảnh, HMR) đi tiếp như bình thường.
 */
export async function startMockWorker(): Promise<void> {
  restoreMockState(browserStorage());
  await setupWorker(...handlers).start({
    onUnhandledRequest: "bypass",
    quiet: false,
  });
}
