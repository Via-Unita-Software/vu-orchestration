import type { ContextLoader, ContextResult, OrchestratorEvent } from '@vu-orchestration/core';

export class FreshdeskContextLoader implements ContextLoader {
  type = 'freshdesk';

  async load(params: Record<string, unknown>, event: OrchestratorEvent): Promise<ContextResult> {
    const baseUrl = params['base_url'] as string;
    const apiKey = params['api_key'] as string;
    const ticketId =
      (params['ticket_id'] as string) || (event.payload['ticket_id'] as string);

    if (!baseUrl || !apiKey || !ticketId) {
      throw new Error('Freshdesk loader requires base_url, api_key, and ticket_id');
    }

    const auth = Buffer.from(`${apiKey}:X`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };

    const [ticketRes, convRes] = await Promise.all([
      fetch(`${baseUrl}/api/v2/tickets/${ticketId}`, { headers }),
      fetch(`${baseUrl}/api/v2/tickets/${ticketId}/conversations`, { headers }),
    ]);

    const ticket = ticketRes.ok ? await ticketRes.json() : null;
    const conversations = convRes.ok ? await convRes.json() : [];

    return { type: 'freshdesk', data: { ticket, conversations, ticketId } };
  }
}
