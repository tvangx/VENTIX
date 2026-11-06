import { newMessage, parseMessage } from "@ticketing/event-contracts";
import { SqlExecutor } from "@ticketing/outbox-inbox";
import { handleEventLifecycle } from "./event-lifecycle.handler";

describe("event lifecycle guards", () => {
  const data = {
    event_id: "11111111-1111-4111-8111-111111111111",
    organizer_id: "22222222-2222-4222-8222-222222222222",
    event_version: 2,
    reason: "Test",
  };
  const query = jest.fn();
  const exec: SqlExecutor = { query };
  beforeEach(() => query.mockReset());
  it("rejects legacy messages rather than inventing missing versions", async () => {
    await expect(
      handleEventLifecycle(exec, parseMessage(newMessage("EventCancelled", data))),
    ).rejects.toThrow(/v2/);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects a tenant mismatch before any DB write", async () => {
    const message = parseMessage(
      newMessage("EventCancelled", data, { version: 2, tenant_id: data.event_id }),
    );
    await expect(handleEventLifecycle(exec, message)).rejects.toThrow(/tenant/);
    expect(query).not.toHaveBeenCalled();
  });
  it("ignores unrelated message types", async () => {
    await handleEventLifecycle(
      exec,
      parseMessage(
        newMessage("OrderExpired", { order_id: data.event_id, event_id: data.event_id }),
      ),
    );
    expect(query).not.toHaveBeenCalled();
  });
});
