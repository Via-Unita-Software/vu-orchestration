import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAdminApp } from '../server/api.js';
import type { RunStore, Run } from '@vu/orchestrator/store';
import type { SopDefinition } from '@vu/core';

const TEST_API_KEY = 'test-api-key';

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    sopName: 'test-sop',
    eventSource: 'github',
    eventType: 'push',
    status: 'completed',
    triggerEvent: { event: 'push' },
    result: { answer: 'ok' },
    error: null,
    tokensUsed: 100,
    costUsd: '0.001000' as unknown as null,
    durationMs: 500,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    completedAt: new Date('2024-01-15T10:00:01Z'),
    ...overrides,
  };
}

function makeSop(name: string): SopDefinition {
  return {
    name,
    description: `${name} description`,
    version: '1.0.0',
    trigger: { source: ['github'], type: ['push'] },
    context: [],
    steps: [{ name: 'step-1', prompt: 'Do something', model: 'gpt-4', max_tokens: 500 }],
    writeback: [],
    guardrails: { max_retries: 0, timeout_seconds: 300, require_human_approval: false },
  };
}

function makeStore(runs: Run[]): RunStore {
  return {
    listRuns: vi.fn().mockResolvedValue(runs),
    getRun: vi.fn().mockImplementation(async (id: string) => runs.find(r => r.id === id) ?? null),
    createRun: vi.fn(),
    updateRun: vi.fn(),
  } as unknown as RunStore;
}

function authHeaders() {
  return { Authorization: `Bearer ${TEST_API_KEY}` };
}

describe('Admin API', () => {
  let app: ReturnType<typeof createAdminApp>;
  let mockStore: RunStore;
  const sops = [makeSop('sop-alpha'), makeSop('sop-beta')];

  beforeEach(() => {
    const runs = [
      makeRun({ id: 'run-1', sopName: 'sop-alpha', status: 'completed' }),
      makeRun({ id: 'run-2', sopName: 'sop-beta', status: 'failed', tokensUsed: 50, costUsd: '0.000500' as unknown as null }),
      makeRun({ id: 'run-3', sopName: 'sop-alpha', status: 'running', tokensUsed: null, costUsd: null }),
    ];
    mockStore = makeStore(runs);
    app = createAdminApp({ runStore: mockStore, sops, apiKey: TEST_API_KEY });
  });

  describe('Authentication', () => {
    it('returns 401 for unauthenticated GET /admin/runs', async () => {
      const res = await app.request('/admin/runs');
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated GET /admin/stats', async () => {
      const res = await app.request('/admin/stats');
      expect(res.status).toBe(401);
    });

    it('returns 401 for unauthenticated GET /admin/sops', async () => {
      const res = await app.request('/admin/sops');
      expect(res.status).toBe(401);
    });

    it('returns 401 for wrong token', async () => {
      const res = await app.request('/admin/runs', { headers: { Authorization: 'Bearer wrong-key' } });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /admin/runs', () => {
    it('returns paginated run list', async () => {
      const res = await app.request('/admin/runs', { headers: authHeaders() });
      expect(res.status).toBe(200);
      const body = await res.json() as { runs: Run[]; total: number; page: number; limit: number };
      expect(body).toHaveProperty('runs');
      expect(body).toHaveProperty('total');
      expect(body).toHaveProperty('page');
      expect(body).toHaveProperty('limit');
      expect(Array.isArray(body.runs)).toBe(true);
      expect(body.page).toBe(1);
      expect(body.limit).toBe(20);
    });

    it('passes status filter to store', async () => {
      const res = await app.request('/admin/runs?status=completed', { headers: authHeaders() });
      expect(res.status).toBe(200);
      expect(mockStore.listRuns).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' })
      );
    });

    it('passes sop filter to store', async () => {
      const res = await app.request('/admin/runs?sop=sop-alpha', { headers: authHeaders() });
      expect(res.status).toBe(200);
      expect(mockStore.listRuns).toHaveBeenCalledWith(
        expect.objectContaining({ sopName: 'sop-alpha' })
      );
    });

    it('respects page and limit params', async () => {
      const res = await app.request('/admin/runs?page=2&limit=1', { headers: authHeaders() });
      expect(res.status).toBe(200);
      const body = await res.json() as { runs: Run[]; total: number; page: number; limit: number };
      expect(body.page).toBe(2);
      expect(body.limit).toBe(1);
      expect(body.runs.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /admin/runs/:id', () => {
    it('returns run detail for existing id', async () => {
      const res = await app.request('/admin/runs/run-1', { headers: authHeaders() });
      expect(res.status).toBe(200);
      const body = await res.json() as Run;
      expect(body.id).toBe('run-1');
      expect(body.sopName).toBe('sop-alpha');
    });

    it('returns 404 for unknown id', async () => {
      const res = await app.request('/admin/runs/nonexistent', { headers: authHeaders() });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /admin/stats', () => {
    it('returns aggregated stats with correct shape', async () => {
      const res = await app.request('/admin/stats', { headers: authHeaders() });
      expect(res.status).toBe(200);
      const body = await res.json() as {
        runsPerDay: { date: string; count: number }[];
        tokenUsage: { date: string; tokens: number }[];
        errorRate: number;
        totalCostUsd: string;
        runsBySop: { sop: string; count: number; successRate: number }[];
      };

      expect(Array.isArray(body.runsPerDay)).toBe(true);
      expect(Array.isArray(body.tokenUsage)).toBe(true);
      expect(typeof body.errorRate).toBe('number');
      expect(typeof body.totalCostUsd).toBe('string');
      expect(Array.isArray(body.runsBySop)).toBe(true);

      // 1 of 3 runs is failed → errorRate ≈ 0.333
      expect(body.errorRate).toBeCloseTo(1 / 3, 5);

      // Runs by SOP entries
      const sopNames = body.runsBySop.map(r => r.sop);
      expect(sopNames).toContain('sop-alpha');
      expect(sopNames).toContain('sop-beta');

      // sop-alpha: 2 runs, 1 completed → successRate = 0.5
      const alpha = body.runsBySop.find(r => r.sop === 'sop-alpha')!;
      expect(alpha.count).toBe(2);
      expect(alpha.successRate).toBeCloseTo(0.5);
    });

    it('runsPerDay entries have date and count fields', async () => {
      const res = await app.request('/admin/stats', { headers: authHeaders() });
      const body = await res.json() as { runsPerDay: { date: string; count: number }[] };
      if (body.runsPerDay.length > 0) {
        const entry = body.runsPerDay[0];
        expect(entry).toHaveProperty('date');
        expect(entry).toHaveProperty('count');
      }
    });
  });

  describe('GET /admin/sops', () => {
    it('returns SOP list', async () => {
      const res = await app.request('/admin/sops', { headers: authHeaders() });
      expect(res.status).toBe(200);
      const body = await res.json() as { sops: SopDefinition[] };
      expect(Array.isArray(body.sops)).toBe(true);
      expect(body.sops.length).toBe(2);
      const names = body.sops.map(s => s.name);
      expect(names).toContain('sop-alpha');
      expect(names).toContain('sop-beta');
    });
  });
});
