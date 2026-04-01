import { createHmac } from 'crypto';
import { createEvent } from '@vu/core';
import type { TriggerAdapter, IncomingRequest, OrchestratorEvent } from '@vu/core';

export interface GitHubTriggerConfig {
  tenant: string;
  webhookSecret: string;
}

export class GitHubTriggerAdapter implements TriggerAdapter {
  type = 'github';

  constructor(private config: GitHubTriggerConfig) {}

  async validateSignature(req: IncomingRequest): Promise<boolean> {
    const signature = req.headers['x-hub-signature-256'] as string;
    if (!signature) return false;

    const rawBody =
      typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body);

    const expected =
      'sha256=' +
      createHmac('sha256', this.config.webhookSecret).update(rawBody).digest('hex');

    return signature === expected;
  }

  async parseWebhook(req: IncomingRequest): Promise<OrchestratorEvent> {
    const event = req.headers['x-github-event'] as string;
    const body = req.body as Record<string, unknown>;
    const delivery =
      (req.headers['x-github-delivery'] as string) || crypto.randomUUID();

    let type: string;
    const payload: Record<string, unknown> = { ...body };

    if (event === 'pull_request') {
      const action = body.action as string;
      const pr = body.pull_request as Record<string, unknown>;
      type =
        action === 'opened'
          ? 'pr.opened'
          : action === 'closed' && (pr?.merged as boolean)
          ? 'pr.merged'
          : `pr.${action}`;
      Object.assign(payload, {
        pr_number: pr?.number,
        pr_title: pr?.title,
        pr_url: pr?.html_url,
        base_branch: (pr?.base as Record<string, unknown>)?.ref,
        head_branch: (pr?.head as Record<string, unknown>)?.ref,
        author: (pr?.user as Record<string, unknown>)?.login,
        repo_full_name: (body.repository as Record<string, unknown>)?.full_name,
      });
    } else if (event === 'push') {
      type = 'push';
      Object.assign(payload, {
        ref: body.ref,
        commits: body.commits,
        pusher: (body.pusher as Record<string, unknown>)?.name,
        repo_full_name: (body.repository as Record<string, unknown>)?.full_name,
      });
    } else if (event === 'issues') {
      const action = body.action as string;
      type = action === 'opened' ? 'issue.created' : `issue.${action}`;
      const issue = body.issue as Record<string, unknown>;
      Object.assign(payload, {
        issue_number: issue?.number,
        issue_title: issue?.title,
        author: (issue?.user as Record<string, unknown>)?.login,
        repo_full_name: (body.repository as Record<string, unknown>)?.full_name,
      });
    } else {
      type = `github.${event}`;
    }

    return createEvent({
      source: 'github',
      sourceEventId: delivery,
      type,
      payload,
      meta: {
        tenant: this.config.tenant,
        deduplicationKey: `github:${delivery}`,
        interactive: false,
      },
    });
  }
}
