import type { WritebackAdapter, WritebackAction, WritebackResult } from '@vu/core';

export interface FreshdeskWritebackConfig {
  apiKey: string;
  domain: string; // e.g. "yourcompany.freshdesk.com"
}

export class FreshdeskWritebackAdapter implements WritebackAdapter {
  type = 'freshdesk';
  allowedActions = ['note', 'tag', 'group', 'reply_draft'];

  constructor(private config: FreshdeskWritebackConfig) {}

  private get baseUrl(): string {
    return `https://${this.config.domain}`;
  }

  private get authHeader(): string {
    // Freshdesk uses Basic auth with API key as username and any password
    return 'Basic ' + Buffer.from(`${this.config.apiKey}:X`).toString('base64');
  }

  async execute(action: WritebackAction): Promise<WritebackResult> {
    const { action: actionType, params } = action;
    const headers = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
    };

    try {
      if (actionType === 'note') {
        const { ticket_id, body, private: isPrivate } = params as Record<
          string,
          unknown
        >;
        const response = await fetch(
          `${this.baseUrl}/api/v2/tickets/${ticket_id}/notes`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ body, private: isPrivate ?? true }),
          }
        );
        if (!response.ok) throw new Error(`Freshdesk API error: ${response.status}`);
        const result = (await response.json()) as Record<string, unknown>;
        return { success: true, output: { note_id: result.id } };
      }

      if (actionType === 'tag') {
        const { ticket_id, tags } = params as Record<string, unknown>;
        const response = await fetch(
          `${this.baseUrl}/api/v2/tickets/${ticket_id}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({ tags }),
          }
        );
        if (!response.ok) throw new Error(`Freshdesk API error: ${response.status}`);
        return { success: true, output: { ticket_id } };
      }

      if (actionType === 'group') {
        const { ticket_id, group_id } = params as Record<string, unknown>;
        const response = await fetch(
          `${this.baseUrl}/api/v2/tickets/${ticket_id}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({ group_id }),
          }
        );
        if (!response.ok) throw new Error(`Freshdesk API error: ${response.status}`);
        return { success: true, output: { ticket_id, group_id } };
      }

      if (actionType === 'reply_draft') {
        const { ticket_id, body } = params as Record<string, unknown>;
        // Implemented as a public note (reply draft)
        const response = await fetch(
          `${this.baseUrl}/api/v2/tickets/${ticket_id}/notes`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ body, private: false }),
          }
        );
        if (!response.ok) throw new Error(`Freshdesk API error: ${response.status}`);
        const result = (await response.json()) as Record<string, unknown>;
        return { success: true, output: { note_id: result.id, ticket_id } };
      }

      return { success: false, error: `Unknown action: ${actionType}` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
