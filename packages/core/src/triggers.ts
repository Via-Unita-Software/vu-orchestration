import type { OrchestratorEvent } from './events.js';

export interface IncomingRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  rawBody?: Buffer | string;
  params?: Record<string, string>;
}

export interface TriggerAdapter {
  type: string;
  parseWebhook(req: IncomingRequest): Promise<OrchestratorEvent>;
  validateSignature(req: IncomingRequest): Promise<boolean>;
}
