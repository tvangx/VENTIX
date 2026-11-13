import { randomUUID } from "node:crypto";
import { NftRepository } from "../../src/modules/nft/nft.repository";
import { NftRunner } from "../../src/modules/nft/nft-runner";
import { MockMinter } from "../../src/modules/nft/minter";
import { fixture } from "../support/ticket";
import { issuedTicket, nftInbox } from "../support/nft";

describe("S-502 concurrent NFT delivery and claims", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeAll(async () => {
    context = await fixture();
  });
  afterAll(async () => {
    await context?.close();
  });
  it("50 duplicates and 50 business replays create one job; 50 workers mint once", async () => {
    const { message } = await issuedTicket(context);
    const inbox = nftInbox(context);
    await Promise.all(Array.from({ length: 50 }, () => inbox.deliver(message)));
    await Promise.all(
      Array.from({ length: 50 }, () => inbox.deliver({ ...message, message_id: randomUUID() })),
    );
    expect((await context.repo.pool.query("SELECT * FROM nft_mints")).rowCount).toBe(1);
    const minter = new MockMinter();
    const mint = jest.spyOn(minter, "mint");
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        new NftRunner(new NftRepository(context.repo), minter, {
          maxAttempts: 3,
          leaseMs: 30000,
          timeoutMs: 1000,
          retryBaseMs: 100,
          retryMaxMs: 1000,
        }).runOnce(),
      ),
    );
    expect(results.filter((result) => result === "MINTED")).toHaveLength(1);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(inbox.dead).toHaveLength(0);
  });
});
