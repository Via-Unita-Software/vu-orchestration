import { createEvent } from '@vu/core';
import type { TriggerAdapter, IncomingRequest, OrchestratorEvent } from '@vu/core';

export interface FreshdeskTriggerConfig {
  tenant: string;
  secret?: string; // optional shared secret via header
}

export class FreshdeskTriggerAdapter implements TriggerAdapter {
  type = 'freshdesk';

  constructor(private config: FreshdeskTriggerConfig) {}

  async validateSignature(req: IncomingRequest): Promise<boolean> {
    if (!this.config.secret) return true; // Freshdesk uses IP whitelisting by default
    const provided = req.headers['x-freshdesk-secret'];
    return provided === this.config.secret;
  }

  async parseWebhook(req: IncomingRequest): Promise<OrchestratorEvent> {
    const body = req.body as Record<string, unknown>;

    // Freshdesk webhooks may nest data under different keys
    const freshdesk_data = (body.freshdesk_webhook as Record<string, unknown>) || body;
    const ticket = (freshdesk_data.ticket as Record<string, unknown>) || freshdesk_data;

    const ticketId =
      (ticket.id as string | number) ||
      (freshdesk_data.ticket_id as string | number) ||
      (body.ticket_id as string | number) ||
      crypto.randomUUID();

    const eventType = (body.event as string) || (body.action as string) || 'created';
    const type = eventType === 'created' ? 'ticket.created' : 'ticket.updated';

    const payload: Record<string, unknown> = {
      ...body,
      ticket_id: ticketId,
      status: ticket.status ?? freshdesk_data.ticket_status,
      group_id: ticket.group_id ?? freshdesk_data.ticket_group_id,
      tags: ticket.tags ?? freshdesk_data.ticket_tags ?? [],
      subject: ticket.subject ?? freshdesk_data.ticket_subject,
      description: ticket.description ?? freshdesk_data.ticket_description,
    };

    return createEvent({
      source: 'freshdesk',
      sourceEventId: String(ticketId),
      type,
      payload,
      meta: {
        tenant: this.config.tenant,
        deduplicationKey: `freshdesk:${ticketId}:${eventType}`,
        interactive: false,
      },
    });
  }
}
