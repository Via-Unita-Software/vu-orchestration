import type { WritebackAdapter, WritebackAction, WritebackResult } from '@vu-orchestration/core';

export interface JiraWritebackConfig {
  baseUrl: string; // e.g. "https://yourcompany.atlassian.net"
  email: string;
  apiToken: string;
}

export class JiraWritebackAdapter implements WritebackAdapter {
  type = 'jira';
  allowedActions = ['comment', 'label', 'transition'];

  constructor(private config: JiraWritebackConfig) {}

  private get authHeader(): string {
    return (
      'Basic ' +
      Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')
    );
  }

  async execute(action: WritebackAction): Promise<WritebackResult> {
    const { action: actionType, params } = action;
    const headers = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    try {
      if (actionType === 'comment') {
        const { issue_key, body } = params as Record<string, unknown>;
        const response = await fetch(
          `${this.config.baseUrl}/rest/api/3/issue/${issue_key}/comment`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              body: {
                type: 'doc',
                version: 1,
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: body }],
                  },
                ],
              },
            }),
          }
        );
        if (!response.ok) throw new Error(`Jira API error: ${response.status}`);
        const result = (await response.json()) as Record<string, unknown>;
        return { success: true, output: { comment_id: result.id } };
      }

      if (actionType === 'label') {
        const { issue_key, labels } = params as Record<string, unknown>;
        const response = await fetch(
          `${this.config.baseUrl}/rest/api/3/issue/${issue_key}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({ fields: { labels } }),
          }
        );
        if (!response.ok) throw new Error(`Jira API error: ${response.status}`);
        return { success: true, output: { issue_key } };
      }

      if (actionType === 'transition') {
        const { issue_key, transition_id } = params as Record<string, unknown>;
        const response = await fetch(
          `${this.config.baseUrl}/rest/api/3/issue/${issue_key}/transitions`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ transition: { id: transition_id } }),
          }
        );
        if (!response.ok) throw new Error(`Jira API error: ${response.status}`);
        return { success: true, output: { issue_key, transition_id } };
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
