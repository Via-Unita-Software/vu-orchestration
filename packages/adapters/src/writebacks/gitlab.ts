import type { WritebackAdapter, WritebackAction, WritebackResult } from '@vu/core';

export interface GitLabWritebackConfig {
  apiToken: string;
  baseUrl?: string; // default: https://gitlab.com
}

export class GitLabWritebackAdapter implements WritebackAdapter {
  type = 'gitlab';
  allowedActions = ['mr_note', 'issue_create', 'file_commit'];

  constructor(private config: GitLabWritebackConfig) {}

  async execute(action: WritebackAction): Promise<WritebackResult> {
    const { action: actionType, params } = action;
    const headers = {
      'PRIVATE-TOKEN': this.config.apiToken,
      'Content-Type': 'application/json',
    };
    const baseUrl = this.config.baseUrl || 'https://gitlab.com';

    try {
      if (actionType === 'mr_note') {
        const { project_id, mr_iid, body } = params as Record<string, string>;
        const encodedProject = encodeURIComponent(project_id);
        const response = await fetch(
          `${baseUrl}/api/v4/projects/${encodedProject}/merge_requests/${mr_iid}/notes`,
          { method: 'POST', headers, body: JSON.stringify({ body }) }
        );
        if (!response.ok) throw new Error(`GitLab API error: ${response.status}`);
        const result = (await response.json()) as Record<string, unknown>;
        return { success: true, output: { note_id: result.id } };
      }

      if (actionType === 'issue_create') {
        const { project_id, title, description, labels } = params as Record<
          string,
          string
        >;
        const encodedProject = encodeURIComponent(project_id);
        const response = await fetch(
          `${baseUrl}/api/v4/projects/${encodedProject}/issues`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ title, description, labels }),
          }
        );
        if (!response.ok) throw new Error(`GitLab API error: ${response.status}`);
        const result = (await response.json()) as Record<string, unknown>;
        return {
          success: true,
          output: { issue_iid: result.iid, web_url: result.web_url },
        };
      }

      if (actionType === 'file_commit') {
        const { project_id, file_path, commit_message, content, branch } =
          params as Record<string, string>;
        const encodedProject = encodeURIComponent(project_id);
        const encodedPath = encodeURIComponent(file_path);

        // Check if file exists to decide create vs update
        let method = 'POST';
        try {
          const existing = await fetch(
            `${baseUrl}/api/v4/projects/${encodedProject}/repository/files/${encodedPath}?ref=${branch || 'main'}`,
            { headers }
          );
          if (existing.ok) {
            method = 'PUT';
          }
        } catch {
          // File doesn't exist, use POST
        }

        const response = await fetch(
          `${baseUrl}/api/v4/projects/${encodedProject}/repository/files/${encodedPath}`,
          {
            method,
            headers,
            body: JSON.stringify({
              branch: branch || 'main',
              content,
              commit_message,
            }),
          }
        );
        if (!response.ok) throw new Error(`GitLab API error: ${response.status}`);
        return { success: true, output: { file_path } };
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
