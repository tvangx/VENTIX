import { IMinter, mintRequest, retryDelayMs } from "./minter";
import { MintJob, NftRepository } from "./nft.repository";

export interface RunnerOptions {
  maxAttempts: number;
  leaseMs: number;
  timeoutMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
}
export type MintOutcome = "IDLE" | "MINTED" | "RETRY" | "FAILED" | "STALE";

export class NftRunner {
  constructor(
    private readonly repo: NftRepository,
    private readonly minter: IMinter,
    private readonly options: RunnerOptions,
    private readonly observe: (job: MintJob, outcome: MintOutcome) => void = () => undefined,
  ) {}

  async runOnce(): Promise<MintOutcome> {
    const job = await this.repo.claim(this.options);
    if (!job) return "IDLE";
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: MintOutcome;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("MINT_TIMEOUT"));
        }, this.options.timeoutMs);
      });
      const result = await Promise.race([
        this.minter.mint(mintRequest(job.ticket_id, job.event_id), controller.signal),
        timeout,
      ]);
      outcome = (await this.repo.complete(job, result)) ? "MINTED" : "STALE";
    } catch {
      const delay = retryDelayMs(job.attempts, this.options.retryBaseMs, this.options.retryMaxMs);
      const updated = await this.repo.fail(job, this.options.maxAttempts, delay);
      outcome = !updated ? "STALE" : job.attempts >= this.options.maxAttempts ? "FAILED" : "RETRY";
    } finally {
      clearTimeout(timer);
    }
    this.observe(job, outcome);
    return outcome;
  }
}
