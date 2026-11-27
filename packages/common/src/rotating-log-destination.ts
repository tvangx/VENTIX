import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Writable } from "node:stream";

/**
 * Best-effort asynchronous JSON log sink. It is intentionally detached from request latency:
 * a full/unwritable disk drops only file copies while stdout logging continues.
 */
export class RotatingLogDestination extends Writable {
  private readonly queue: Buffer[] = [];
  private draining = false;
  private bytes = 0;
  private initialized = false;

  constructor(
    private readonly path: string,
    private readonly maxBytes: number,
    private readonly maxFiles: number,
    private readonly maxQueue = 10_000,
  ) {
    super();
  }

  override _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: () => void): void {
    if (this.queue.length < this.maxQueue) {
      this.queue.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      void this.drain();
    }
    // Logging must never back-pressure the business request path.
    callback();
  }

  async flush(): Promise<void> {
    while (this.draining || this.queue.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      if (!this.initialized) {
        await mkdir(dirname(this.path), { recursive: true });
        this.bytes = (await stat(this.path).catch(() => undefined))?.size ?? 0;
        this.initialized = true;
      }
      while (this.queue.length) {
        const line = this.queue.shift();
        if (!line) continue;
        if (this.bytes > 0 && this.bytes + line.length > this.maxBytes) await this.rotate();
        await appendFile(this.path, line);
        this.bytes += line.length;
      }
    } catch {
      // stdout remains the authoritative local runtime log; file collection is best-effort.
      this.queue.length = 0;
    } finally {
      this.draining = false;
      if (this.queue.length) void this.drain();
    }
  }

  private async rotate(): Promise<void> {
    for (let index = this.maxFiles - 1; index >= 1; index--) {
      await rename(`${this.path}.${index}`, `${this.path}.${index + 1}`).catch(() => undefined);
    }
    await rename(this.path, `${this.path}.1`).catch(() => undefined);
    this.bytes = 0;
  }
}
