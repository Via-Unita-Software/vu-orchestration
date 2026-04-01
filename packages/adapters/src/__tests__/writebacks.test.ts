import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubWritebackAdapter } from '../writebacks/github.js';
import { GitLabWritebackAdapter } from '../writebacks/gitlab.js';
import { FreshdeskWritebackAdapter } from '../writebacks/freshdesk.js';
import { JiraWritebackAdapter } from '../writebacks/jira.js';
import { EmailWritebackAdapter } from '../writebacks/email.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchOk(responseBody: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => responseBody,
  });
}

function mockFetchFail(status = 422) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ message: 'Unprocessable Entity' }),
  });
}

// ---------------------------------------------------------------------------
// GitHub Writeback
// ---------------------------------------------------------------------------

describe('GitHubWritebackAdapter', () => {
  let adapter: GitHubWritebackAdapter;

  beforeEach(() => {
    adapter = new GitHubWritebackAdapter({ apiToken: 'ghp_test_token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct type and allowedActions', () => {
    expect(adapter.type).toBe('github');
    expect(adapter.allowedActions).toContain('pr_comment');
    expect(adapter.allowedActions).toContain('issue_create');
    expect(adapter.allowedActions).toContain('file_commit');
  });

  it('executes pr_comment action', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOk({ id: 999, html_url: 'https://github.com/acme/repo/pull/42#comment-999' })
    );

    const result = await adapter.execute({
      type: 'github',
      action: 'pr_comment',
      params: { owner: 'acme', repo: 'repo', pr_number: '42', body: 'LGTM!' },
    });

    expect(result.success).toBe(true);
    expect(result.output?.comment_id).toBe(999);
    expect(result.output?.url).toContain('github.com');
  });

  it('executes issue_create action', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOk({ number: 10, html_url: 'https://github.com/acme/repo/issues/10' })
    );

    const result = await adapter.execute({
      type: 'github',
      action: 'issue_create',
      params: { owner: 'acme', repo: 'repo', title: 'Bug', body: 'Details', labels: [] },
    });

    expect(result.success).toBe(true);
    expect(result.output?.issue_number).toBe(10);
  });

  it('executes file_commit action (new file)', async () => {
    // First call: GET to check existing file -> 404
    // Second call: PUT to create file -> 200
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await adapter.execute({
      type: 'github',
      action: 'file_commit',
      params: {
        owner: 'acme',
        repo: 'repo',
        path: 'README.md',
        message: 'Add README',
        content: 'Hello world',
        branch: 'main',
      },
    });

    expect(result.success).toBe(true);
    expect(result.output?.path).toBe('README.md');
  });

  it('returns error on API failure', async () => {
    vi.stubGlobal('fetch', mockFetchFail(403));

    const result = await adapter.execute({
      type: 'github',
      action: 'pr_comment',
      params: { owner: 'acme', repo: 'repo', pr_number: '42', body: 'Comment' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
  });

  it('returns error for unknown action', async () => {
    const result = await adapter.execute({
      type: 'github',
      action: 'unknown_action',
      params: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('unknown_action');
  });
});

// ---------------------------------------------------------------------------
// GitLab Writeback
// ---------------------------------------------------------------------------

describe('GitLabWritebackAdapter', () => {
  let adapter: GitLabWritebackAdapter;

  beforeEach(() => {
    adapter = new GitLabWritebackAdapter({ apiToken: 'gl-token' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct type and allowedActions', () => {
    expect(adapter.type).toBe('gitlab');
    expect(adapter.allowedActions).toContain('mr_note');
    expect(adapter.allowedActions).toContain('issue_create');
    expect(adapter.allowedActions).toContain('file_commit');
  });

  it('executes mr_note action', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ id: 55 }));

    const result = await adapter.execute({
      type: 'gitlab',
      action: 'mr_note',
      params: { project_id: 'acme/repo', mr_iid: '3', body: 'Nice work!' },
    });

    expect(result.success).toBe(true);
    expect(result.output?.note_id).toBe(55);
  });

  it('executes issue_create action', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOk({ iid: 7, web_url: 'https://gitlab.com/acme/repo/-/issues/7' })
    );

    const result = await adapter.execute({
      type: 'gitlab',
      action: 'issue_create',
      params: {
        project_id: 'acme/repo',
        title: 'Need help',
        description: 'Details here',
        labels: 'bug',
      },
    });

    expect(result.success).toBe(true);
    expect(result.output?.issue_iid).toBe(7);
  });

  it('returns error for unknown action', async () => {
    const result = await adapter.execute({
      type: 'gitlab',
      action: 'bad_action',
      params: {},
    });
    expect(result.success).toBe(false);
  });

  it('returns error on API failure', async () => {
    vi.stubGlobal('fetch', mockFetchFail(500));

    const result = await adapter.execute({
      type: 'gitlab',
      action: 'mr_note',
      params: { project_id: 'acme/repo', mr_iid: '3', body: 'Note' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });
});

// ---------------------------------------------------------------------------
// Freshdesk Writeback
// ---------------------------------------------------------------------------

describe('FreshdeskWritebackAdapter', () => {
  let adapter: FreshdeskWritebackAdapter;

  beforeEach(() => {
    adapter = new FreshdeskWritebackAdapter({
      apiKey: 'fd-api-key',
      domain: 'acme.freshdesk.com',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct type and allowedActions', () => {
    expect(adapter.type).toBe('freshdesk');
    expect(adapter.allowedActions).toContain('note');
    expect(adapter.allowedActions).toContain('tag');
    expect(adapter.allowedActions).toContain('group');
    expect(adapter.allowedActions).toContain('reply_draft');
  });

  it('executes note action', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ id: 200 }));

    const result = await adapter.execute({
      type: 'freshdesk',
      action: 'note',
      params: { ticket_id: 500, body: 'Internal note here', private: true },
    });

    expect(result.success).toBe(true);
    expect(result.output?.note_id).toBe(200);
  });

  it('executes tag action', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ id: 500 }));

    const result = await adapter.execute({
      type: 'freshdesk',
      action: 'tag',
      params: { ticket_id: 500, tags: ['urgent', 'vip'] },
    });

    expect(result.success).toBe(true);
    expect(result.output?.ticket_id).toBe(500);
  });

  it('executes group action', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ id: 500 }));

    const result = await adapter.execute({
      type: 'freshdesk',
      action: 'group',
      params: { ticket_id: 500, group_id: 99 },
    });

    expect(result.success).toBe(true);
    expect(result.output?.group_id).toBe(99);
  });

  it('executes reply_draft action', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ id: 201 }));

    const result = await adapter.execute({
      type: 'freshdesk',
      action: 'reply_draft',
      params: { ticket_id: 500, body: 'Draft reply content' },
    });

    expect(result.success).toBe(true);
  });

  it('returns error for unknown action', async () => {
    const result = await adapter.execute({
      type: 'freshdesk',
      action: 'unknown',
      params: {},
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Jira Writeback
// ---------------------------------------------------------------------------

describe('JiraWritebackAdapter', () => {
  let adapter: JiraWritebackAdapter;

  beforeEach(() => {
    adapter = new JiraWritebackAdapter({
      baseUrl: 'https://acme.atlassian.net',
      email: 'bot@acme.com',
      apiToken: 'jira-token',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('has correct type and allowedActions', () => {
    expect(adapter.type).toBe('jira');
    expect(adapter.allowedActions).toContain('comment');
    expect(adapter.allowedActions).toContain('label');
    expect(adapter.allowedActions).toContain('transition');
  });

  it('executes comment action', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ id: '10001' }));

    const result = await adapter.execute({
      type: 'jira',
      action: 'comment',
      params: { issue_key: 'PROJ-42', body: 'Fixed in latest deploy' },
    });

    expect(result.success).toBe(true);
    expect(result.output?.comment_id).toBe('10001');
  });

  it('executes label action', async () => {
    vi.stubGlobal('fetch', mockFetchOk({}));

    const result = await adapter.execute({
      type: 'jira',
      action: 'label',
      params: { issue_key: 'PROJ-42', labels: ['bug', 'p1'] },
    });

    expect(result.success).toBe(true);
    expect(result.output?.issue_key).toBe('PROJ-42');
  });

  it('executes transition action', async () => {
    vi.stubGlobal('fetch', mockFetchOk({}));

    const result = await adapter.execute({
      type: 'jira',
      action: 'transition',
      params: { issue_key: 'PROJ-42', transition_id: '31' },
    });

    expect(result.success).toBe(true);
    expect(result.output?.transition_id).toBe('31');
  });

  it('returns error for unknown action', async () => {
    const result = await adapter.execute({
      type: 'jira',
      action: 'bad',
      params: {},
    });
    expect(result.success).toBe(false);
  });

  it('returns error on API failure', async () => {
    vi.stubGlobal('fetch', mockFetchFail(404));

    const result = await adapter.execute({
      type: 'jira',
      action: 'comment',
      params: { issue_key: 'PROJ-99', body: 'Test' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('404');
  });
});

// ---------------------------------------------------------------------------
// Email Writeback
// ---------------------------------------------------------------------------

describe('EmailWritebackAdapter', () => {
  let adapter: EmailWritebackAdapter;

  beforeEach(() => {
    adapter = new EmailWritebackAdapter({
      provider: 'sendgrid',
      apiKey: 'SG.test',
      from: 'bot@acme.com',
    });
  });

  it('has correct type and allowedActions', () => {
    expect(adapter.type).toBe('email');
    expect(adapter.allowedActions).toContain('send');
  });

  it('returns error when requireApproval is not true', async () => {
    const result = await adapter.execute({
      type: 'email',
      action: 'send',
      params: { to: 'user@example.com', subject: 'Hello', body: 'World' },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('require_human_approval');
  });

  it('returns error when requireApproval is false', async () => {
    const result = await adapter.execute({
      type: 'email',
      action: 'send',
      params: {
        to: 'user@example.com',
        subject: 'Hello',
        body: 'World',
        requireApproval: false,
      },
    });

    expect(result.success).toBe(false);
  });

  it('succeeds when requireApproval is true', async () => {
    const result = await adapter.execute({
      type: 'email',
      action: 'send',
      params: {
        to: 'user@example.com',
        subject: 'Hello',
        body: 'World',
        requireApproval: true,
      },
    });

    expect(result.success).toBe(true);
    expect(result.output?.to).toBe('user@example.com');
    expect(result.output?.subject).toBe('Hello');
  });
});
