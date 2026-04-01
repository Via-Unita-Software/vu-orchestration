import type { OrchestratorEvent } from './events.js';

export interface ContextResult {
  type: string;
  data: Record<string, unknown>;
}

export interface ContextLoader {
  type: string;
  load(params: Record<string, unknown>, event: OrchestratorEvent): Promise<ContextResult>;
}
