import { bookingHandlers } from "./booking";
import { eventHandlers } from "./event";
import { financeHandlers } from "./finance";
import { identityHandlers } from "./identity";
import { organizerHandlers } from "./organizer";
import { paymentHandlers } from "./payment";

// Chỉ service đã có OpenAPI thật. Merch/ticket/resale thêm khi có OpenAPI (V-204...).
export const handlers = [
  ...identityHandlers,
  ...eventHandlers,
  ...organizerHandlers,
  ...bookingHandlers,
  ...paymentHandlers,
  ...financeHandlers,
];
