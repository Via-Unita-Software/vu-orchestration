import type { OrchestratorEvent, SopDefinition } from '@vu-orchestration/core';

export function matchSop(
  event: OrchestratorEvent,
  sops: SopDefinition[]
): SopDefinition | null {
  for (const sop of sops) {
    const { trigger } = sop;

    // Check source match
    if (!trigger.source.includes(event.source)) continue;

    // Check type match
    if (!trigger.type.includes(event.type)) continue;

    // Check filters (if any)
    if (trigger.filter) {
      let filterMatch = true;
      for (const [key, value] of Object.entries(trigger.filter)) {
        const payloadValue = (event.payload as Record<string, unknown>)[key];
        const allowedValues = Array.isArray(value) ? value : [value];
        if (!allowedValues.includes(payloadValue as string)) {
          filterMatch = false;
          break;
        }
      }
      if (!filterMatch) continue;
    }

    return sop; // First match wins
  }
  return null;
}
