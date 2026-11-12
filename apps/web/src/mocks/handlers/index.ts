import { bookingHandlers } from "./booking";
import { financeHandlers } from "./finance";
import { identityHandlers } from "./identity";
import { paymentHandlers } from "./payment";

// Chỉ service đã có OpenAPI thật. Event/merch/ticket/resale thêm khi có OpenAPI (V-201, V-204...).
export const handlers = [
  ...identityHandlers,
  ...bookingHandlers,
  ...paymentHandlers,
  ...financeHandlers,
];
