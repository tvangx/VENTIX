import { randomUUID } from "node:crypto";
import { NftRepository } from "../../src/modules/nft/nft.repository";
import { NftRunner } from "../../src/modules/nft/nft-runner";
import { IMinter, MockMinter, mintRequest } from "../../src/modules/nft/minter";
import { fixture } from "../support/ticket";
import { issuedTicket, nftInbox } from "../support/nft";

describe("S-502 durable NFT queue", () => {
  let context: Awaited<ReturnType<typeof fixture>>;
  let repo: NftRepository;
  let inbox: ReturnType<typeof nftInbox>;
  const options = {
    maxAttempts: 3,
    leaseMs: 30000,
    timeoutMs: 100,
    retryBaseMs: 100,
    retryMaxMs: 1000,
  };
  beforeAll(async () => {
    context = await fixture();
    repo = new NftRepository(context.repo);
    inbox = nftInbox(context);
  });
  beforeEach(async () => {
    await context.repo.pool.query("DELETE FROM nft_mints");
    inbox = nftInbox(context);
  });
  afterAll(async () => {
    await context?.close();
  });
  async function enqueue() {
    const issued = await issuedTicket(context);
    await inbox.deliver(issued.message);
    return issued;
  }
  async function row(ticketId: string) {
    return (await context.repo.pool.query("SELECT * FROM nft_mints WHERE ticket_id=$1", [ticketId]))
      .rows[0];
  }

  it("deduplicates message and business replay; rejects conflicting replay", async () => {
    const { message, replay } = await enqueue();
    await inbox.deliver(message);
    await inbox.deliver(replay);
    await inbox.deliver({
      ...message,
      message_id: randomUUID(),
      tenant_id: message.tenant_id?.toUpperCase(),
      data: {
        ticket_id: message.data.ticket_id.toUpperCase(),
        order_id: message.data.order_id.toUpperCase(),
        order_item_id: message.data.order_item_id.toUpperCase(),
        event_id: message.data.event_id.toUpperCase(),
        seat_id: message.data.seat_id?.toUpperCase() ?? null,
        owner_user_id: message.data.owner_user_id.toUpperCase(),
      },
    });
    expect(inbox.dead).toHaveLength(0);
    expect((await context.repo.pool.query("SELECT * FROM nft_mints")).rowCount).toBe(1);
    await inbox.deliver({
      ...replay,
      message_id: randomUUID(),
      data: { ...replay.data, owner_user_id: randomUUID() },
    });
    expect(inbox.dead).toHaveLength(1);
    expect((await row(message.data.ticket_id)).attempts).toBe(0);
  });

  it("rejects nonexistent or mismatched tickets without committing a job", async () => {
    const { message } = await issuedTicket(context);
    await inbox.deliver({ ...message, data: { ...message.data, event_id: randomUUID() } });
    await inbox.deliver({
      ...message,
      message_id: randomUUID(),
      data: { ...message.data, ticket_id: randomUUID() },
    });
    expect((await context.repo.pool.query("SELECT * FROM nft_mints")).rowCount).toBe(0);
    expect(
      (
        await context.repo.pool.query("SELECT * FROM processed_events WHERE message_id=$1", [
          message.message_id,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("rolls back the job if Inbox commit fails, then safely redelivers", async () => {
    const { message } = await issuedTicket(context);
    await context.repo.pool
      .query(`CREATE FUNCTION s502_fail_inbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.consumer='ticket-nft-v1' THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$;
      CREATE CONSTRAINT TRIGGER s502_fail_inbox AFTER INSERT ON processed_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION s502_fail_inbox()`);
    try {
      await inbox.deliver(message);
      expect((await context.repo.pool.query("SELECT * FROM nft_mints")).rowCount).toBe(0);
    } finally {
      await context.repo.pool.query(
        "DROP TRIGGER s502_fail_inbox ON processed_events; DROP FUNCTION s502_fail_inbox()",
      );
    }
    await inbox.deliver(message);
    expect(await row(message.data.ticket_id)).toMatchObject({ status: "PENDING" });
  });

  it("persists mock success and keeps off-chain ticket/secret unchanged", async () => {
    const { message } = await enqueue();
    const before = await context.repo.pool.query("SELECT * FROM tickets WHERE id=$1", [
      message.data.ticket_id,
    ]);
    const runner = new NftRunner(repo, new MockMinter(), options);
    expect(await runner.runOnce()).toBe("MINTED");
    expect(await runner.runOnce()).toBe("IDLE");
    expect(await row(message.data.ticket_id)).toMatchObject({
      status: "MINTED",
      provider: "MOCK",
      tx_hash: null,
      attempts: 1,
    });
    expect(
      (await context.repo.pool.query("SELECT * FROM tickets WHERE id=$1", [message.data.ticket_id]))
        .rows,
    ).toEqual(before.rows);
    expect(
      (
        await context.repo.pool.query("SELECT * FROM ticket_secrets WHERE ticket_id=$1", [
          message.data.ticket_id,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it("retries across runner restart, sanitizes provider failures and respects next_attempt_at", async () => {
    const { message } = await enqueue();
    const minter: IMinter = {
      mint: async () => {
        throw new Error("private provider credential");
      },
    };
    expect(
      await new NftRunner(repo, minter, {
        ...options,
        retryBaseMs: 10000,
        retryMaxMs: 10000,
      }).runOnce(),
    ).toBe("RETRY");
    expect(await row(message.data.ticket_id)).toMatchObject({
      status: "PENDING",
      last_error: "MINT_FAILED",
      attempts: 1,
    });
    expect(await new NftRunner(repo, new MockMinter(), options).runOnce()).toBe("IDLE");
    await context.repo.pool.query("UPDATE nft_mints SET next_attempt_at=now()-interval '1 second'");
    expect(await new NftRunner(repo, new MockMinter(), options).runOnce()).toBe("MINTED");
  });

  it("limits failed attempts without revoking or blocking an issued ticket", async () => {
    const { message } = await enqueue();
    const runner = new NftRunner(
      repo,
      {
        mint: async () => {
          throw new Error("down");
        },
      },
      { ...options, maxAttempts: 1 },
    );
    expect(await runner.runOnce()).toBe("FAILED");
    expect(await runner.runOnce()).toBe("IDLE");
    expect(await row(message.data.ticket_id)).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(
      (
        await context.repo.pool.query("SELECT status,secret_version FROM tickets WHERE id=$1", [
          message.data.ticket_id,
        ])
      ).rows[0],
    ).toEqual({ status: "ACTIVE", secret_version: 1 });
  });

  it("times out and aborts a hung provider", async () => {
    await enqueue();
    let signal: AbortSignal | undefined;
    const minter: IMinter = {
      mint: (_request, passedSignal) => {
        signal = passedSignal;
        return new Promise(() => undefined);
      },
    };
    expect(await new NftRunner(repo, minter, { ...options, timeoutMs: 10 }).runOnce()).toBe(
      "RETRY",
    );
    expect(signal?.aborted).toBe(true);
  });

  it("recovers a crash after provider success and fences stale completions", async () => {
    const { message } = await enqueue();
    const old = await repo.claim(options);
    expect(old).not.toBeNull();
    const result = await new MockMinter().mint(
      mintRequest(message.data.ticket_id, message.data.event_id),
      new AbortController().signal,
    );
    await context.repo.pool.query("UPDATE nft_mints SET lease_until=now()-interval '1 second'");
    const fresh = await repo.claim(options);
    expect(fresh).not.toBeNull();
    expect(await repo.complete(old!, result)).toBe(false);
    expect(await repo.fail(old!, options.maxAttempts, 100)).toBe(false);
    const replayResult = await new MockMinter().mint(
      mintRequest(message.data.ticket_id, message.data.event_id),
      new AbortController().signal,
    );
    expect(replayResult).toEqual(result);
    expect(await repo.complete(fresh!, replayResult)).toBe(true);
  });

  it("terminates a lease abandoned on the last attempt", async () => {
    await enqueue();
    await repo.claim({ ...options, maxAttempts: 1 });
    await context.repo.pool.query("UPDATE nft_mints SET lease_until=now()-interval '1 second'");
    expect(await repo.claim({ ...options, maxAttempts: 1 })).toBeNull();
    expect(
      (await context.repo.pool.query("SELECT status,last_error FROM nft_mints")).rows[0],
    ).toEqual({ status: "FAILED", last_error: "LEASE_EXPIRED" });
  });
});
