import { requirePricingReady } from "./pricing-readiness";
import { ProblemException } from "@ticketing/common";

describe("local pricing readiness gate for holds and checkout", () => {
  it("blocks incomplete pricing and permits a completed snapshot", () => {
    expect.assertions(4);
    try {
      requirePricingReady({ pricing_ready: false });
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemException);
      if (error instanceof ProblemException) {
        expect(error.getStatus()).toBe(503);
        expect(error.getResponse()).toMatchObject({ code: "EVENT_NOT_READY" });
      }
    }
    expect(() => requirePricingReady({ pricing_ready: true })).not.toThrow();
  });
});
