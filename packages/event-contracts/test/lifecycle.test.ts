import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newMessage, parseMessage } from "../src";

const snapshot = () => ({
  event_id: randomUUID(),
  organizer_id: randomUUID(),
  title: "Test event",
  start_at: "2026-12-01T00:00:00.000Z",
  end_at: "2026-12-02T00:00:00.000Z",
  event_version: 2,
  seat_map_version: 1,
  ticket_classes: [{ id: randomUUID(), name: "GA", price_vnd: 100000, capacity: 10, kind: "GA" }],
  sale_phases: [],
});

describe("lifecycle v2 (T-203)", () => {
  it.each(["EventApproved", "EventUpdated"])("%s carries a complete snapshot", (type) => {
    const data = snapshot();
    expect(parseMessage(newMessage(type, data, { version: 2 }))).toMatchObject({
      version: 2,
      data,
    });
    const missing = { ...data, seat_map_version: undefined };
    expect(() => parseMessage(newMessage(type, missing, { version: 2 }))).toThrow();
    expect(() =>
      parseMessage(newMessage(type, { ...data, ticket_classes: undefined }, { version: 2 })),
    ).toThrow();
  });
  it("requires event_version on v2 cancellation", () => {
    const data = {
      event_id: randomUUID(),
      organizer_id: randomUUID(),
      reason: "Test",
      event_version: 3,
    };
    expect(parseMessage(newMessage("EventCancelled", data, { version: 2 }))).toMatchObject({
      data,
    });
    expect(() =>
      parseMessage(
        newMessage("EventCancelled", { ...data, event_version: undefined }, { version: 2 }),
      ),
    ).toThrow();
  });
  it("still parses legacy lifecycle v1 and rejects unknown versions", () => {
    expect(
      parseMessage(
        newMessage("EventUpdated", {
          event_id: randomUUID(),
          organizer_id: randomUUID(),
          event_version: 1,
        }),
      ).version,
    ).toBe(1);
    expect(() => parseMessage(newMessage("EventApproved", snapshot(), { version: 3 }))).toThrow();
  });
});
