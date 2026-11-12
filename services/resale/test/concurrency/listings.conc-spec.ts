import { randomUUID } from "node:crypto";
import { fixture } from "../support/resale";

describe("S-304 listing unique index", () => {
  it("50 competing inserts allow only one ACTIVE listing per ticket", async () => {
    const context = await fixture();
    try {
      const ticketId = randomUUID();
      const results = await Promise.allSettled(
        Array.from({ length: 50 }, () => context.insert(ticketId)),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      for (const result of results)
        if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "23505" });
      await context.repo.pool.query(
        "UPDATE listings SET status='CANCELLED',version=version+1 WHERE ticket_id=$1",
        [ticketId],
      );
      await expect(context.insert(ticketId)).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await context.close();
    }
  });
});
