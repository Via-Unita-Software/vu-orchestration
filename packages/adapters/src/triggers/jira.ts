import { createEvent } from '@vu-orchestration/core';
import type { TriggerAdapter, IncomingRequest, OrchestratorEvent } from '@vu-orchestration/core';

export interface JiraTriggerConfig {
  tenant: string;
  sharedSecret: string;
}

export class JiraTriggerAdapter implements TriggerAdapter {
  type = 'jira';

  constructor(private config: JiraTriggerConfig) {}

  async validateSignature(req: IncomingRequest): Promise<boolean> {
    const secret = req.headers['x-atlassian-secret'] as string;
    if (!secret) return false;
    return secret === this.config.sharedSecret;
  }

  async parseWebhook(req: IncomingRequest): Promise<OrchestratorEvent> {
    const body = req.body as Record<string, unknown>;
    const webhookEvent = body.webhookEvent as string;
    const issue = body.issue as Record<string, unknown> | undefined;
    const fields = issue?.fields as Record<string, unknown> | undefined;

    // Derive event type
    let type: string;
    if (webhookEvent === 'jira:issue_created') {
      type = 'issue.created';
    } else if (webhookEvent === 'jira:issue_updated') {
      // Check if it's a transition
      const changelog = body.changelog as Record<string, unknown> | undefined;
      const items = (changelog?.items as Array<Record<string, unknown>>) || [];
      const isTransition = items.some((item) => item.field === 'status');
      type = isTransition ? 'issue.transitioned' : 'issue.updated';
    } else {
      type = webhookEvent ? `jira.${webhookEvent.replace('jira:', '')}` : 'jira.event';
    }

    const issueKey = issue?.key as string | undefined;
    const sourceEventId =
      (body.timestamp as string) ||
      (body.id as string) ||
      (issueKey ? `${issueKey}:${Date.now()}` : crypto.randomUUID());

    const payload: Record<string, unknown> = {
      ...body,
      issue_key: issueKey,
      summary: (fields?.summary as string) || undefined,
      status: ((fields?.status as Record<string, unknown>)?.name as string) || undefined,
      assignee:
        ((fields?.assignee as Record<string, unknown>)?.displayName as string) || undefined,
      issue_type:
        ((fields?.issuetype as Record<string, unknown>)?.name as string) || undefined,
    };

    return createEvent({
      source: 'jira',
      sourceEventId: String(sourceEventId),
      type,
      payload,
      meta: {
        tenant: this.config.tenant,
        deduplicationKey: `jira:${sourceEventId}`,
        interactive: false,
      },
    });
  }
}
