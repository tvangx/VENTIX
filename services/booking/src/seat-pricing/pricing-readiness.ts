import { ProblemException } from "@ticketing/common";

/** Dùng trước giữ ghế và trước tạo order (T-301); controller trả Retry-After: 1 cho lỗi 503. */
export function requirePricingReady(snapshot: { pricing_ready: boolean }): void {
  if (!snapshot.pricing_ready)
    throw new ProblemException("EVENT_NOT_READY", 503, "Event pricing is not ready; retry later");
}
