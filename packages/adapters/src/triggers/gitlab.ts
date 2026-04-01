import { createEvent } from '@vu/core';
import type { TriggerAdapter, IncomingRequest, OrchestratorEvent } from '@vu/core';

export interface GitLabTriggerConfig {
  tenant: string;
  webhookToken: string;
}

export class GitLabTriggerAdapter implements TriggerAdapter {
  type = 'gitlab';

  constructor(private config: GitLabTriggerConfig) {}

  async validateSignature(req: IncomingRequest): Promise<boolean> {
    const token = req.headers['x-gitlab-token'] as string;
    if (!token) return false;
    return token === this.config.webhookToken;
  }

  async parseWebhook(req: IncomingRequest): Promise<OrchestratorEvent> {
    const body = req.body as Record<string, unknown>;
    const objectKind = body.object_kind as string;
    const eventId =
      (body.event_id as string) ||
      (body.object_attributes as Record<string, unknown>)?.iid?.toString() ||
      crypto.randomUUID();

    let type: string;
    const payload: Record<string, unknown> = { ...body };

    if (objectKind === 'merge_request') {
      const attrs = body.object_attributes as Record<string, unknown>;
      const action = attrs?.action as string;
      type =
        action === 'open' || action === 'reopen'
          ? 'mr.opened'
          : action === 'merge'
          ? 'mr.merged'
          : `mr.${action}`;
      Object.assign(payload, {
        mr_iid: attrs?.iid,
        mr_title: attrs?.title,
        mr_url: attrs?.url,
        source_branch: attrs?.source_branch,
        target_branch: attrs?.target_branch,
        author: (body.user as Record<string, unknown>)?.username,
        repo_full_name: (body.project as Record<string, unknown>)?.path_with_namespace,
      });
    } else if (objectKind === 'push') {
      type = 'push';
      Object.assign(payload, {
        ref: body.ref,
        commits: body.commits,
        pusher: (body.user_username as string) || (body.user_name as string),
        repo_full_name: (body.project as Record<string, unknown>)?.path_with_namespace,
      });
    } else if (objectKind === 'note') {
      type = 'mr.note';
      const attrs = body.object_attributes as Record<string, unknown>;
      Object.assign(payload, {
        note: attrs?.note,
        noteable_type: attrs?.noteable_type,
        author: (body.user as Record<string, unknown>)?.username,
        repo_full_name: (body.project as Record<string, unknown>)?.path_with_namespace,
      });
    } else if (objectKind === 'issue') {
      const attrs = body.object_attributes as Record<string, unknown>;
      const action = attrs?.action as string;
      type = action === 'open' || action === 'reopen' ? 'issue.created' : `issue.${action}`;
      Object.assign(payload, {
        issue_iid: attrs?.iid,
        issue_title: attrs?.title,
        author: (body.user as Record<string, unknown>)?.username,
        repo_full_name: (body.project as Record<string, unknown>)?.path_with_namespace,
      });
    } else {
      type = `gitlab.${objectKind}`;
    }

    return createEvent({
      source: 'gitlab',
      sourceEventId: String(eventId),
      type,
      payload,
      meta: {
        tenant: this.config.tenant,
        deduplicationKey: `gitlab:${eventId}`,
        interactive: false,
      },
    });
  }
}
