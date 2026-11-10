import { activeQueuePhase } from "./sale-phase";

describe("active queue phase from booking snapshot", () => {
  const start = "2026-11-10T00:00:00.000Z";
  const end = "2026-11-10T01:00:00.000Z";
  const phase = { starts_at: start, ends_at: end, queue_enabled: true, admit_rate: 3 };
  it("selects the active phase and includes start but excludes end", () => {
    expect(activeQueuePhase([phase], Date.parse(start))).toEqual(phase);
    expect(activeQueuePhase([phase], Date.parse(end))).toBeUndefined();
    expect(activeQueuePhase([phase], Date.parse(start) - 1)).toBeUndefined();
  });
  it("supports queue-disabled and legacy windows without assuming they are enabled", () => {
    expect(
      activeQueuePhase({ ...phase, queue_enabled: false }, Date.parse(start))?.queue_enabled,
    ).toBe(false);
    expect(activeQueuePhase({ starts_at: start, ends_at: end }, Date.parse(start))).toBeUndefined();
  });
  it.each([0, -1, 1.5, "2"])("rejects invalid admission rate %s", (admit_rate) => {
    expect(activeQueuePhase([{ ...phase, admit_rate }], Date.parse(start))).toBeUndefined();
  });
});
