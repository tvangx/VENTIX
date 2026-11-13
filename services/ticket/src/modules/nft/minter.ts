import { createHash } from "node:crypto";

export interface MintRequest {
  idempotencyKey: string;
  metadata: { name: string; ticket_id: string; event_id: string };
}

export interface MintResult {
  provider: "MOCK";
  tokenId: string;
  txHash: null;
  metadataUri: string;
  mockReference: string;
}

/** Adapter phải trả lại cùng kết quả khi gọi lại key sau timeout/crash. */
export interface IMinter {
  mint(request: MintRequest, signal: AbortSignal): Promise<MintResult>;
}

export function mintRequest(ticketId: string, eventId: string): MintRequest {
  return {
    idempotencyKey: `ticket:${ticketId}`,
    metadata: { name: "VENTIX ticket", ticket_id: ticketId, event_id: eventId },
  };
}

export class MockMinter implements IMinter {
  async mint(request: MintRequest, signal: AbortSignal): Promise<MintResult> {
    signal.throwIfAborted();
    const digest = createHash("sha256")
      .update(`ventix-mock-v1:${request.idempotencyKey}`)
      .digest("hex");
    return {
      provider: "MOCK",
      tokenId: BigInt(`0x${digest}`).toString(),
      txHash: null,
      metadataUri: `mock://ticket/${request.metadata.ticket_id}`,
      mockReference: `mock:${digest}`,
    };
  }
}

export function retryDelayMs(
  attempt: number,
  base: number,
  maximum: number,
  random = Math.random,
): number {
  const cap = Math.min(maximum, base * 2 ** Math.min(attempt - 1, 30));
  return Math.max(1, Math.round(cap * (0.5 + random() * 0.5)));
}
