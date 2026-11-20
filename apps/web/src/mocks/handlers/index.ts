import { bookingHandlers } from "./booking";
import { eventHandlers } from "./event";
import { financeHandlers } from "./finance";
import { identityHandlers } from "./identity";
import { paymentHandlers } from "./payment";

// Chỉ service đã có OpenAPI thật. Merch/ticket/resale thêm khi có OpenAPI (V-204...).
export const handlers = [
  ...identityHandlers,
  ...eventHandlers,
  ...bookingHandlers,
  ...paymentHandlers,
  ...financeHandlers,
];
