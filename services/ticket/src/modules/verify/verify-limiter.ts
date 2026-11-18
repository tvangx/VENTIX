/** Giới hạn mỗi process; socket peer không lấy từ header do client cung cấp. */
export class VerifyLimiter {
  private readonly peers = new Map<string, number>();
  private total = 0;
  private expiresAt = 0;
  constructor(
    private readonly perPeer: number,
    private readonly globalLimit: number,
    private readonly windowMs: number,
    private readonly maxPeers = 10000,
    private readonly now = Date.now,
  ) {}

  take(peer: string): number {
    const now = this.now();
    if (now >= this.expiresAt) {
      this.peers.clear();
      this.total = 0;
      this.expiresAt = now + this.windowMs;
    }
    const used = this.peers.get(peer) ?? 0;
    if (
      used >= this.perPeer ||
      this.total >= this.globalLimit ||
      (!this.peers.has(peer) && this.peers.size >= this.maxPeers)
    ) {
      return Math.max(1, Math.ceil((this.expiresAt - now) / 1000));
    }
    this.peers.set(peer, used + 1);
    this.total++;
    return 0;
  }
}
