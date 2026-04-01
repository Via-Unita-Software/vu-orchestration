import type { WritebackAdapter, WritebackAction, WritebackResult } from '@vu/core';

export interface GitHubWritebackConfig {
  apiToken: string;
  baseUrl?: string; // default: https://api.github.com
}

export class GitHubWritebackAdapter implements WritebackAdapter {
  type = 'github';
  allowedActions = ['pr_comment', 'issue_create', 'file_commit'];

  constructor(private config: GitHubWritebackConfig) {}

  async execute(action: WritebackAction): Promise<WritebackResult> {
    const { action: actionType, params } = action;
    const headers = {
      Authorization: `token ${this.config.apiToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
    };
    const baseUrl = this.config.baseUrl || 'https://api.github.com';

    try {
      if (actionType === 'pr_comment') {
        const { owner, repo, pr_number, body } = params as Record<string, string>;
        const response = await fetch(
          `${baseUrl}/repos/${owner}/${repo}/issues/${pr_number}/comments`,
          { method: 'POST', headers, body: JSON.stringify({ body }) }
        );
        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        const result = (await response.json()) as Record<string, unknown>;
        return { success: true, output: { comment_id: result.id, url: result.html_url } };
      }

      if (actionType === 'issue_create') {
        const { owner, repo, title, body, labels } = params as Record<string, unknown>;
        const response = await fetch(`${baseUrl}/repos/${owner}/${repo}/issues`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title, body, labels }),
        });
        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        const result = (await response.json()) as Record<string, unknown>;
        return { success: true, output: { issue_number: result.number, url: result.html_url } };
      }

      if (actionType === 'file_commit') {
        const { owner, repo, path, message, content, branch } = params as Record<
          string,
          string
        >;
        const encoded = Buffer.from(content).toString('base64');
        // Get current file SHA if it exists
        let sha: string | undefined;
        try {
          const existing = await fetch(
            `${baseUrl}/repos/${owner}/${repo}/contents/${path}${branch ? `?ref=${branch}` : ''}`,
            { headers }
          );
          if (existing.ok) {
            const data = (await existing.json()) as Record<string, unknown>;
            sha = data.sha as string;
          }
        } catch {
          // File doesn't exist yet, sha remains undefined
        }

        const response = await fetch(
          `${baseUrl}/repos/${owner}/${repo}/contents/${path}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify({ message, content: encoded, sha, branch }),
          }
        );
        if (!response.ok) throw new Error(`GitHub API error: ${response.status}`);
        return { success: true, output: { path } };
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
