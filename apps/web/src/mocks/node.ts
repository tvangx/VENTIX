import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/** Server MSW cho Vitest (môi trường node); dùng cùng bộ handler với trình duyệt. */
export const mockServer = setupServer(...handlers);
