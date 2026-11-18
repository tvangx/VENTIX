import { apiClient } from "@/lib/http/client";
import type { paths as BookingPaths } from "./generated/booking";
import type { paths as EventPaths } from "./generated/event";
import type { paths as FinancePaths } from "./generated/finance";
import type { paths as IdentityPaths } from "./generated/identity";
import type { paths as PaymentPaths } from "./generated/payment";
import { createServiceClient } from "./typed-client";

// Tiền tố route Kong (infra/kong/kong.yml, strip_path); dùng chung cho client và MSW handler.
export const SERVICE_PREFIX = {
  identity: "/identity",
  event: "/event",
  booking: "/booking",
  payment: "/payment",
  finance: "/finance",
} as const;

export const identityApi = createServiceClient<IdentityPaths>(apiClient, SERVICE_PREFIX.identity);
export const eventApi = createServiceClient<EventPaths>(apiClient, SERVICE_PREFIX.event);
export const bookingApi = createServiceClient<BookingPaths>(apiClient, SERVICE_PREFIX.booking);
export const paymentApi = createServiceClient<PaymentPaths>(apiClient, SERVICE_PREFIX.payment);
export const financeApi = createServiceClient<FinancePaths>(apiClient, SERVICE_PREFIX.finance);

export type { BookingPaths, EventPaths, FinancePaths, IdentityPaths, PaymentPaths };
export type { components as IdentitySchemas } from "./generated/identity";
export type { components as EventSchemas } from "./generated/event";
export type { components as BookingSchemas } from "./generated/booking";
export type { components as PaymentSchemas } from "./generated/payment";
export type { components as FinanceSchemas } from "./generated/finance";
export { toProblem, type Problem } from "./problem";
export { createServiceClient, type ServiceClient } from "./typed-client";
