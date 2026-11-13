import { ProblemException } from "@ticketing/common";

export function maximumPrice(original: bigint, percent: number): bigint {
  if (original < 0n || !Number.isInteger(percent) || percent < 1 || percent > 120)
    throw new Error("INVALID_PRICE_CAP");
  return (original * BigInt(percent)) / 100n;
}

export function assertPriceCap(original: bigint, asking: bigint, percent: number): void {
  if (asking < 0n || asking > maximumPrice(original, percent))
    throw new ProblemException("RESALE_PRICE_CAP_EXCEEDED", 422, "Giá niêm yết vượt trần cho phép");
}
