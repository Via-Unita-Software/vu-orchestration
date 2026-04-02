import type { ContextLoader, ContextResult, OrchestratorEvent } from '@vu-orchestration/core';

export class JiraContextLoader implements ContextLoader {
  type = 'jira';

  async load(params: Record<string, unknown>, event: OrchestratorEvent): Promise<ContextResult> {
    const baseUrl = params['base_url'] as string;
    const apiToken = params['api_token'] as string;
    const email = params['email'] as string;
    const issueKey =
      (params['issue_key'] as string) || (event.payload['issue_key'] as string);

    if (!baseUrl || !apiToken || !email || !issueKey) {
      throw new Error('Jira loader requires base_url, api_token, email, and issue_key');
    }

    const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');
    const headers = { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' };

    const [issueRes, commentsRes] = await Promise.all([
      fetch(`${baseUrl}/rest/api/3/issue/${issueKey}`, { headers }),
      fetch(`${baseUrl}/rest/api/3/issue/${issueKey}/comment`, { headers }),
    ]);

    const issue = issueRes.ok ? await issueRes.json() : null;
    const comments = commentsRes.ok ? await commentsRes.json() : { comments: [] };

    return {
      type: 'jira',
      data: { issue, comments: (comments as { comments: unknown[] }).comments, issueKey },
    };
  }
}
