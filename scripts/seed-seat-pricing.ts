import { createRequire } from "node:module";
import { join } from "node:path";

// Chạy qua pnpm --filter @ticketing/booking pricing:seed sau khi build booking.
const bookingRequire = createRequire(join(process.cwd(), "package.json"));
const { seedSeatPricing } = bookingRequire("./dist/tools/pricing-seed.js") as {
  seedSeatPricing(): Promise<void>;
};
seedSeatPricing().catch(() => {
  process.stderr.write("Seat pricing seed failed; check configuration and synthetic seat input\n");
  process.exitCode = 1;
});
