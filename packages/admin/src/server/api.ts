import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { SopDefinition } from '@vu/core';
import type { RunStore, Run } from '@vu/orchestrator/store';

export interface AdminDeps {
  runStore: RunStore;
  sops: SopDefinition[];
  apiKey: string;
}

export function createAdminApp(deps: AdminDeps): Hono {
  const { runStore, sops, apiKey } = deps;

  const app = new Hono();

  app.use('/admin/*', cors());

  // Bearer token auth middleware
  app.use('/admin/*', async (c, next) => {
    const auth = c.req.header('Authorization');
    if (!auth || auth !== `Bearer ${apiKey}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
  });

  // GET /admin/runs — Paginated run list
  app.get('/admin/runs', async (c) => {
    const status = c.req.query('status') as Run['status'] | undefined;
    const sop = c.req.query('sop');
    const from = c.req.query('from');
    const to = c.req.query('to');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = parseInt(c.req.query('limit') ?? '20', 10);

    const allRuns = await runStore.listRuns({
      status: status,
      sopName: sop,
      fromDate: from ? new Date(from) : undefined,
      toDate: to ? new Date(to) : undefined,
      limit: 10000,
    });

    const total = allRuns.length;
    const offset = (page - 1) * limit;
    const pageRuns = allRuns.slice(offset, offset + limit);

    return c.json({ runs: pageRuns, total, page, limit });
  });

  // GET /admin/runs/:id — Single run detail
  app.get('/admin/runs/:id', async (c) => {
    const id = c.req.param('id');
    const run = await runStore.getRun(id);
    if (!run) {
      return c.json({ error: `Run ${id} not found` }, 404);
    }
    return c.json(run);
  });

  // GET /admin/stats — Aggregated metrics
  app.get('/admin/stats', async (c) => {
    const allRuns = await runStore.listRuns({ limit: 10000 });

    // Runs per day
    const runsPerDayMap = new Map<string, number>();
    const tokenPerDayMap = new Map<string, number>();
    let totalTokens = 0;
    let totalCost = 0;
    let failedCount = 0;
    const sopCountMap = new Map<string, number>();
    const sopSuccessMap = new Map<string, number>();

    for (const run of allRuns) {
      const date = run.createdAt.toISOString().slice(0, 10);

      runsPerDayMap.set(date, (runsPerDayMap.get(date) ?? 0) + 1);

      const tokens = run.tokensUsed ?? 0;
      tokenPerDayMap.set(date, (tokenPerDayMap.get(date) ?? 0) + tokens);
      totalTokens += tokens;

      if (run.costUsd) {
        totalCost += parseFloat(run.costUsd as unknown as string);
      }

      if (run.status === 'failed') {
        failedCount++;
      }

      sopCountMap.set(run.sopName, (sopCountMap.get(run.sopName) ?? 0) + 1);
      if (run.status === 'completed') {
        sopSuccessMap.set(run.sopName, (sopSuccessMap.get(run.sopName) ?? 0) + 1);
      }
    }

    const runsPerDay = Array.from(runsPerDayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    const tokenUsage = Array.from(tokenPerDayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, tokens]) => ({ date, tokens }));

    const errorRate = allRuns.length > 0 ? failedCount / allRuns.length : 0;

    const runsBySop = Array.from(sopCountMap.entries()).map(([sop, count]) => ({
      sop,
      count,
      successRate: count > 0 ? (sopSuccessMap.get(sop) ?? 0) / count : 0,
    }));

    return c.json({
      runsPerDay,
      tokenUsage,
      errorRate,
      totalCostUsd: totalCost.toFixed(6),
      runsBySop,
    });
  });

  // GET /admin/sops — Loaded SOPs
  app.get('/admin/sops', (c) => {
    return c.json({ sops });
  });

  return app;
}
