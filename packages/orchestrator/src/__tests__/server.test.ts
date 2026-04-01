import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from '../server.js';
import type { ServerDependencies } from '../server.js';
import type { TenantConfig, SopDefinition, TriggerAdapter, OrchestratorEvent } from '@vu/core';
import type { Run } from '../store.js';

// --- Minimal mocks ---

function makeConfig(): TenantConfig {
  return {
    tenant: { id: 'tenant-1', name: 'Test Tenant' },
    ai_hub: {
      openwebui_url: 'http://localhost:8080',
      tool_endpoints: { chat: '/api/chat', run: '/api/run' },
    },
    adapters: { triggers: [], writebacks: [] },
    llm: {
      default_provider: 'openai',
      providers: { openai: { api_key_ref: 'OPENAI_KEY' } },
    },
    secrets: { backend: 'env' },
  };
}

function makeSop(overrides: Partial<SopDefinition> = {}): SopDefinition {
  return {
    name: 'test-sop',
    description: 'Test SOP',
    version: '1.0.0',
    trigger: { source: ['github'], type: ['pull_request.opened'] },
    context: [],
    steps: [{ name: 'step1', prompt: 'Do something', model: 'gpt-4', max_tokens: 1000 }],
    writeback: [],
    guardrails: { max_retries: 0, timeout_seconds: 300, require_human_approval: false },
    ...overrides,
  };
}

function makeEvent(overrides: Partial<OrchestratorEvent> = {}): OrchestratorEvent {
  return {
    id: 'evt-abc-123',
    source: 'github',
    sourceEventId: 'gh-001',
    type: 'pull_request.opened',
    timestamp: new Date().toISOString(),
    payload: { action: 'opened' },
    meta: { tenant: 'tenant-1', deduplicationKey: 'gh-001', interactive: false },
    ...overrides,
  };
}

function makeRun(status: Run['status'] = 'queued'): Run {
  return {
    id: 'run-1',
    sopName: 'test-sop',
    eventSource: 'github',
    eventType: 'pull_request.opened',
    status,
    triggerEvent: {},
    result: null,
    error: null,
    tokensUsed: null,
    costUsd: null,
    durationMs: null,
    createdAt: new Date(),
    completedAt: null,
  };
}

function makeDeps(overrides: Partial<ServerDependencies> = {}): ServerDependencies {
  const mockDedup = {
    isDuplicate: vi.fn().mockResolvedValue(false),
  };
  const mockQueue = {
    dispatch: vi.fn().mockResolvedValue('job-1'),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockStore = {
    createRun: vi.fn().mockResolvedValue(makeRun()),
    updateRun: vi.fn().mockResolvedValue(makeRun()),
    getRun: vi.fn().mockResolvedValue(makeRun('completed')),
    listRuns: vi.fn().mockResolvedValue([]),
  };

  const mockAdapter: TriggerAdapter = {
    type: 'github',
    parseWebhook: vi.fn().mockResolvedValue(makeEvent()),
    validateSignature: vi.fn().mockResolvedValue(true),
  };
  const adapters = new Map<string, TriggerAdapter>([['github', mockAdapter]]);

  return {
    config: makeConfig(),
    sops: [makeSop()],
    adapters,
    queue: mockQueue as any,
    dedup: mockDedup as any,
    store: mockStore as any,
    configPath: 'config/config.yaml',
    ...overrides,
  };
}

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = createServer(makeDeps());
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });
});

describe('POST /webhooks/:adapterType', () => {
  it('returns 404 for unknown adapter type', async () => {
    const app = createServer(makeDeps());
    const res = await app.request('/webhooks/unknown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 when signature validation fails', async () => {
    const mockAdapter: TriggerAdapter = {
      type: 'github',
      parseWebhook: vi.fn(),
      validateSignature: vi.fn().mockResolvedValue(false),
    };
    const adapters = new Map<string, TriggerAdapter>([['github', mockAdapter]]);
    const app = createServer(makeDeps({ adapters }));

    const res = await app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for duplicate events', async () => {
    const mockDedup = { isDuplicate: vi.fn().mockResolvedValue(true) };
    const app = createServer(makeDeps({ dedup: mockDedup as any }));

    const res = await app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Duplicate event');
  });

  it('returns 202 with no_match when no SOP matches', async () => {
    const deps = makeDeps({ sops: [] });
    const app = createServer(deps);

    const res = await app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('no_match');
  });

  it('returns 202 accepted and dispatches job when event matches SOP', async () => {
    const deps = makeDeps();
    const app = createServer(deps);

    const res = await app.request('/webhooks/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('accepted');
    expect(body.runId).toBeDefined();
    expect(deps.queue.dispatch).toHaveBeenCalledOnce();
  });
});

describe('POST /api/run', () => {
  it('returns 202 with runId for valid async run request', async () => {
    const deps = makeDeps();
    const app = createServer(deps);
    const event = makeEvent();

    const res = await app.request('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('accepted');
    expect(body.runId).toBeDefined();
  });

  it('returns 400 for missing event body', async () => {
    const app = createServer(makeDeps());
    const res = await app.request('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for duplicate event in /api/run', async () => {
    const mockDedup = { isDuplicate: vi.fn().mockResolvedValue(true) };
    const app = createServer(makeDeps({ dedup: mockDedup as any }));

    const res = await app.request('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: makeEvent() }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when no SOP matches in /api/run', async () => {
    const deps = makeDeps({ sops: [] });
    const app = createServer(deps);

    const res = await app.request('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: makeEvent() }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/run/:runId', () => {
  it('returns run data when run exists', async () => {
    const run = makeRun('completed');
    const mockStore = {
      createRun: vi.fn().mockResolvedValue(run),
      updateRun: vi.fn(),
      getRun: vi.fn().mockResolvedValue(run),
      listRuns: vi.fn(),
    };
    const app = createServer(makeDeps({ store: mockStore as any }));

    const res = await app.request('/api/run/run-1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('run-1');
    expect(body.status).toBe('completed');
  });

  it('returns 404 when run does not exist', async () => {
    const mockStore = {
      createRun: vi.fn(),
      updateRun: vi.fn(),
      getRun: vi.fn().mockResolvedValue(null),
      listRuns: vi.fn(),
    };
    const app = createServer(makeDeps({ store: mockStore as any }));

    const res = await app.request('/api/run/nonexistent');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/chat', () => {
  it('returns completed result when job finishes within timeout', async () => {
    const run = makeRun('completed');
    run.result = { answer: '42' };

    const mockStore = {
      createRun: vi.fn().mockResolvedValue(run),
      updateRun: vi.fn(),
      getRun: vi.fn().mockResolvedValue(run),
      listRuns: vi.fn(),
    };
    const deps = makeDeps({ store: mockStore as any });
    const app = createServer(deps);
    const event = makeEvent();

    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, timeoutMs: 2000 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('completed');
    expect(body.runId).toBeDefined();
  });

  it('returns 400 for missing event in /api/chat', async () => {
    const app = createServer(makeDeps());
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('API key middleware', () => {
  it('returns 401 when API key is wrong', async () => {
    const app = createServer(makeDeps({ apiKey: 'secret-key' }));
    const res = await app.request('/api/run/run-1', {
      headers: { Authorization: 'Bearer wrong-key' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 when API key is correct', async () => {
    const run = makeRun('completed');
    const mockStore = {
      createRun: vi.fn(),
      updateRun: vi.fn(),
      getRun: vi.fn().mockResolvedValue(run),
      listRuns: vi.fn(),
    };
    const app = createServer(makeDeps({ apiKey: 'secret-key', store: mockStore as any }));
    const res = await app.request('/api/run/run-1', {
      headers: { Authorization: 'Bearer secret-key' },
    });
    expect(res.status).toBe(200);
  });
});
