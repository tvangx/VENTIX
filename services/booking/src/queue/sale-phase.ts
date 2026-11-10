import { z } from "zod";

const phaseSchema = z.object({
  starts_at: z.string().datetime(),
  ends_at: z.string().datetime(),
  queue_enabled: z.boolean(),
  admit_rate: z.number().int().positive().safe(),
});
export type QueuePhase = z.infer<typeof phaseSchema>;

export function activeQueuePhase(value: unknown, now = Date.now()): QueuePhase | undefined {
  const parsed = z.union([phaseSchema, z.array(phaseSchema)]).safeParse(value);
  if (!parsed.success) return undefined;
  const phases = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  return phases.find(
    (phase) => Date.parse(phase.starts_at) <= now && now < Date.parse(phase.ends_at),
  );
}
