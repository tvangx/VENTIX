import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { newMessage, parseMessage, TicketRevokedV1, topicOf, Topics } from "../src";

describe("issue #72 TicketRevoked versioned reasons", () => {
  it.each(["REFUNDED", "TRANSFERRED", "ADMIN", "EVENT_CANCELLED"])(
    "preserves v1 reason %s",
    (reason) => {
      const message = newMessage("TicketRevoked", { ticket_id: randomUUID(), reason });
      expect(parseMessage(message)).toEqual(TicketRevokedV1.parse(message));
    },
  );

  it.each(["USER_CANCELLED", "EXPIRED", "LATE_PAYMENT", "STOCK_REJECTED", "PAYMENT_FAILED"])(
    "requires v2 for %s",
    (reason) => {
      const message = newMessage(
        "TicketRevoked",
        { ticket_id: randomUUID(), reason },
        { version: 2 },
      );
      expect(parseMessage(message)).toEqual(message);
      expect(() => parseMessage({ ...message, version: 1 })).toThrow();
      expect(() => TicketRevokedV1.parse(message)).toThrow();
      expect(topicOf.TicketRevoked).toBe(Topics.TICKET_EVENTS);
    },
  );

  it("rejects unknown versions/reasons and reads legacy reasons in v2", () => {
    const message = newMessage(
      "TicketRevoked",
      { ticket_id: randomUUID(), reason: "REFUNDED" },
      { version: 2 },
    );
    expect(parseMessage(message).version).toBe(2);
    expect(() => parseMessage({ ...message, version: 3 })).toThrow();
    expect(() =>
      parseMessage({ ...message, data: { ...message.data, reason: "UNKNOWN" } }),
    ).toThrow();
  });
});
