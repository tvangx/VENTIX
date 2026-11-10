/** T-402: rate chính xác đến 1 basis point; net half-up, vat = gross - net.
 * BigInt tránh mất chính xác ở phép nhân dù gross vẫn nằm trong miền safe integer. */
export function splitVat(grossVnd: number, rate: number) {
  if (!Number.isSafeInteger(grossVnd) || grossVnd < 0) throw new Error("Unsafe gross amount");
  const basisPoints = Math.round(rate * 10000);
  if (
    !Number.isFinite(rate) ||
    rate < 0 ||
    rate > 1 ||
    Math.abs(basisPoints / 10000 - rate) > 1e-12
  )
    throw new Error("VAT rate must be between 0 and 1 with at most four decimals");
  const gross = BigInt(grossVnd);
  const denominator = 10000n + BigInt(basisPoints);
  const net = (gross * 10000n + denominator / 2n) / denominator;
  return { gross, net, vat: gross - net };
}
