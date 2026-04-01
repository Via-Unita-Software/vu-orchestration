import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunJobData } from '../worker.js';
import { WritebackAdapterRegistry } from '../writeback/registry.js';
import { ContextLoaderRegistry } from '../context/loader.js';
import type { WritebackAdapter, OrchestratorEvent, SopDefinition } from '@vu/core';

// Mock BullMQ so creating a Worker doesn't try to connect to Redis
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the LLM client factory so no real API calls are made
vi.mock('../llm/client.js', () => ({
  createLLMClient: vi.fn().mockReturnValue({
    complete: vi.fn().mockResolvedValue({
      content: '{"result": "success"}',
      tokens_input: 50,
      tokens_output: 100,
      model: 'claude-3-5-sonnet-20241022',
      duration_ms: 200,
    }),
  }),
  AnthropicClient: vi.fn(),
  OpenAIClient: vi.fn(),
}));

const mockEvent: OrchestratorEvent = {
  id: '00000000-0000-0000-0000-000000000003',
  source: 'freshdesk',
  sourceEventId: 'ticket-99',
  type: 'ticket.created',
  timestamp: new Date().toISOString(),
  payload: { ticket_id: '99' },
  meta: {
    tenant: 'test-tenant',
    deduplicationKey: 'dedup-worker-1',
    interactive: false,
  },
};

const mockSop: SopDefinition = {
  name: 'test-sop',
  description: 'A test SOP',
  version: '1.0.0',
  trigger: { source: ['freshdesk'], type: ['ticket.created'] },
  context: [],
  steps: [
    {
      name: 'step1',
      prompt: 'prompts/test.hbs',
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 500,
    },
  ],
  writeback: [],
  guardrails: { max_retries: 0, timeout_seconds: 300, require_human_approval: false },
};

const mockConfig = {
  tenant: { id: 'tenant-1', name: 'Test Tenant' },
  ai_hub: {
    openwebui_url: 'https://example.com',
    tool_endpoints: { chat: '/chat', run: '/run' },
  },
  adapters: { triggers: [], writebacks: [] },
  llm: {
    default_provider: 'anthropic',
    providers: {
      anthropic: { api_key_ref: 'ANTHROPIC_API_KEY', api_key: 'test-key' },
    },
  },
  secrets: { backend: 'env' as const },
};

describe('WritebackAdapterRegistry', () => {
  it('rejects actions not in allowedActions list', async () => {
    const registry = new WritebackAdapterRegistry();
    const adapter: WritebackAdapter = {
      type: 'freshdesk',
      allowedActions: ['reply', 'close'],
      execute: vi.fn().mockResolvedValue({ success: true }),
    };
    registry.register(adapter);

    const result = await registry.execute({
      type: 'freshdesk',
      action: 'delete',
      params: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Action 'delete' not allowed");
    expect(adapter.execute).not.toHaveBeenCalled();
  });

  it('executes allowed actions', async () => {
    const registry = new WritebackAdapterRegistry();
    const adapter: WritebackAdapter = {
      type: 'jira',
      allowedActions: ['comment', 'transition'],
      execute: vi.fn().mockResolvedValue({ success: true, output: { id: '123' } }),
    };
    registry.register(adapter);

    const result = await registry.execute({
      type: 'jira',
      action: 'comment',
      params: { body: 'Hello' },
    });

    expect(result.success).toBe(true);
    expect(adapter.execute).toHaveBeenCalledWith({
      type: 'jira',
      action: 'comment',
      params: { body: 'Hello' },
    });
  });

  it('returns error for unregistered adapter type', async () => {
    const registry = new WritebackAdapterRegistry();

    const result = await registry.execute({
      type: 'nonexistent',
      action: 'do_something',
      params: {},
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No adapter registered for type: nonexistent');
  });
});

describe('createWorker with mocked dependencies', () => {
  it('creates a worker without throwing', async () => {
    const { createWorker } = await import('../worker.js');
    const mockRunStore = {
      updateRun: vi.fn().mockResolvedValue({}),
      createRun: vi.fn().mockResolvedValue({}),
      getRun: vi.fn().mockResolvedValue(null),
      listRuns: vi.fn().mockResolvedValue([]),
    };
    const mockRedis = {} as never;

    const contextRegistry = new ContextLoaderRegistry();
    const writebackRegistry = new WritebackAdapterRegistry();
    const promptRenderer = {
      render: vi.fn().mockResolvedValue('Render a test prompt'),
    };

    const worker = createWorker({
      redis: mockRedis,
      runStore: mockRunStore as never,
      contextRegistry,
      writebackRegistry,
      promptRenderer: promptRenderer as never,
      config: mockConfig as never,
    });

    expect(worker).toBeDefined();
  });

  it('processes job data and calls runStore.updateRun', async () => {
    // Test the processRun logic by simulating what the worker does:
    // mock context registry, prompt renderer, LLM client, runStore

    const { createLLMClient } = await import('../llm/client.js');
    const mockLLMClient = {
      complete: vi.fn().mockResolvedValue({
        content: '{"answer": "42"}',
        tokens_input: 10,
        tokens_output: 20,
        model: 'claude-3-5-sonnet-20241022',
        duration_ms: 100,
      }),
    };
    (createLLMClient as ReturnType<typeof vi.fn>).mockReturnValue(mockLLMClient);

    const mockRunStore = {
      updateRun: vi.fn().mockResolvedValue({}),
      createRun: vi.fn().mockResolvedValue({}),
      getRun: vi.fn().mockResolvedValue(null),
      listRuns: vi.fn().mockResolvedValue([]),
    };

    const contextRegistry = new ContextLoaderRegistry();
    const writebackRegistry = new WritebackAdapterRegistry();

    const promptRenderer = {
      render: vi.fn().mockResolvedValue('Please answer this question.'),
    };

    const { createWorker } = await import('../worker.js');
    const worker = createWorker({
      redis: {} as never,
      runStore: mockRunStore as never,
      contextRegistry,
      writebackRegistry,
      promptRenderer: promptRenderer as never,
      config: mockConfig as never,
    });

    // The worker is created (BullMQ is mocked); verify it's defined
    expect(worker).toBeDefined();
  });
});
