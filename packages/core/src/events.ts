import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

export const orchestratorEventSchema = z.object({
  id: z.string().uuid(),
  source: z.string().min(1),
  sourceEventId: z.string().min(1),
  type: z.string().min(1),
  timestamp: z.string().datetime(),
  payload: z.record(z.unknown()),
  meta: z.object({
    tenant: z.string().min(1),
    triggeredBy: z.string().optional(),
    deduplicationKey: z.string().min(1),
    interactive: z.boolean(),
  }),
});

export type OrchestratorEvent = z.infer<typeof orchestratorEventSchema>;

export function createEvent(
  params: Omit<OrchestratorEvent, 'id' | 'timestamp'>
): OrchestratorEvent {
  return orchestratorEventSchema.parse({
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    ...params,
  });
}
