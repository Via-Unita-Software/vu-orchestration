import { createEvent } from '@vu/core';
import type { TriggerAdapter, IncomingRequest, OrchestratorEvent } from '@vu/core';

export interface HttpTriggerConfig {
  tenant: string;
  secret?: string; // optional shared secret
}

export class HttpTriggerAdapter implements TriggerAdapter {
  type = 'http';

  constructor(private config: HttpTriggerConfig) {}

  async parseWebhook(req: IncomingRequest): Promise<OrchestratorEvent> {
    const body = req.body as Record<string, unknown>;
    const eventType = (body.type as string) || (body.event_type as string) || 'http.request';
    const sourceEventId = (body.id as string) || (body.event_id as string) || crypto.randomUUID();

    return createEvent({
      source: 'http',
      sourceEventId,
      type: eventType,
      payload: body,
      meta: {
        tenant: this.config.tenant,
        deduplicationKey: `http:${sourceEventId}`,
        interactive: (body.interactive as boolean) || false,
      },
    });
  }

  async validateSignature(req: IncomingRequest): Promise<boolean> {
    if (!this.config.secret) return true; // No secret = allow all
    const provided = req.headers['x-webhook-secret'];
    return provided === this.config.secret;
  }
}
