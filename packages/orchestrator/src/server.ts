import { Hono } from 'hono';
import { v4 as uuidv4 } from 'uuid';
import type { TenantConfig, SopDefinition, TriggerAdapter } from '@vu-orchestration/core';
import { DedupService } from './dedup.js';
import { RunQueue } from './queue.js';
import { RunStore } from './store.js';
import { matchSop } from './router.js';
import { validateWebhookSignature, createApiKeyMiddleware } from './auth.js';

export interface ServerDependencies {
  config: TenantConfig;
  sops: SopDefinition[];
  adapters: Map<string, TriggerAdapter>;
  queue: RunQueue;
  dedup: DedupService;
  store: RunStore;
  configPath?: string;
  apiKey?: string;
}

export function createServer(deps: ServerDependencies): Hono {
  const { config, sops, adapters, queue, dedup, store, configPath = 'config/config.yaml', apiKey } = deps;

  const app = new Hono();

  // Health check
  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Webhook endpoint
  app.post('/webhooks/:adapterType', async (c) => {
    const adapterType = c.req.param('adapterType');
    const adapter = adapters.get(adapterType);

    if (!adapter) {
      return c.json({ error: `Unknown adapter type: ${adapterType}` }, 404);
    }

    // Read the raw body for signature validation
    const rawBody = await c.req.text();
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }

    const headersRecord: Record<string, string | string[] | undefined> = {};
    c.req.raw.headers.forEach((value, key) => {
      headersRecord[key] = value;
    });

    const incomingReq = {
      headers: headersRecord,
      body: parsedBody,
      rawBody,
    };

    // Validate signature
    const isValid = await validateWebhookSignature(adapterType, adapters, incomingReq);
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Parse webhook into event
    let event;
    try {
      event = await adapter.parseWebhook(incomingReq);
    } catch (err) {
      return c.json({ error: 'Failed to parse webhook', details: String(err) }, 400);
    }

    // Deduplication
    const isDup = await dedup.isDuplicate(event.meta.deduplicationKey);
    if (isDup) {
      return c.json({ error: 'Duplicate event' }, 400);
    }

    // Match SOP
    const sop = matchSop(event, sops);
    if (!sop) {
      console.log(`[orchestrator] No SOP matched for event source=${event.source} type=${event.type} id=${event.id}`);
      return c.json({ status: 'no_match', eventId: event.id }, 202);
    }

    // Create run record
    const runId = uuidv4();
    await store.createRun({
      id: runId,
      sopName: sop.name,
      eventSource: event.source,
      eventType: event.type,
      status: 'queued',
      triggerEvent: event as unknown as Record<string, unknown>,
    });

    // Dispatch to queue
    await queue.dispatch({ runId, event, sop, configPath });

    return c.json({ status: 'accepted', runId, eventId: event.id }, 202);
  });

  // Apply API key middleware for /api routes if configured
  const apiRoutes = new Hono();

  if (apiKey) {
    apiRoutes.use('*', createApiKeyMiddleware(apiKey));
  }

  // POST /api/chat - interactive, dispatch and poll
  apiRoutes.post('/chat', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { event: eventData, timeoutMs = 30000 } = body as {
      event: unknown;
      timeoutMs?: number;
    };

    if (!eventData || typeof eventData !== 'object') {
      return c.json({ error: 'Missing event in request body' }, 400);
    }

    const event = eventData as import('@vu-orchestration/core').OrchestratorEvent;

    // Deduplication
    const isDup = await dedup.isDuplicate(event.meta?.deduplicationKey ?? event.id);
    if (isDup) {
      return c.json({ error: 'Duplicate event' }, 400);
    }

    // Match SOP
    const sop = matchSop(event, sops);
    if (!sop) {
      console.log(`[orchestrator] No SOP matched for event source=${event.source} type=${event.type} id=${event.id}`);
      return c.json({ error: 'No SOP matched for this event' }, 404);
    }

    // Create run record
    const runId = uuidv4();
    await store.createRun({
      id: runId,
      sopName: sop.name,
      eventSource: event.source,
      eventType: event.type,
      status: 'queued',
      triggerEvent: event as unknown as Record<string, unknown>,
    });

    // Dispatch to queue
    await queue.dispatch({ runId, event, sop, configPath });

    // Poll for completion
    const pollIntervalMs = 500;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const run = await store.getRun(runId);
      if (run && (run.status === 'completed' || run.status === 'failed')) {
        return c.json({ runId, status: run.status, result: run.result, error: run.error });
      }
    }

    return c.json({ runId, status: 'timeout', message: 'Job did not complete within timeout' }, 202);
  });

  // POST /api/run - async dispatch
  apiRoutes.post('/run', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const { event: eventData } = body as { event: unknown };

    if (!eventData || typeof eventData !== 'object') {
      return c.json({ error: 'Missing event in request body' }, 400);
    }

    const event = eventData as import('@vu-orchestration/core').OrchestratorEvent;

    // Deduplication
    const isDup = await dedup.isDuplicate(event.meta?.deduplicationKey ?? event.id);
    if (isDup) {
      return c.json({ error: 'Duplicate event' }, 400);
    }

    // Match SOP
    const sop = matchSop(event, sops);
    if (!sop) {
      console.log(`[orchestrator] No SOP matched for event source=${event.source} type=${event.type} id=${event.id}`);
      return c.json({ error: 'No SOP matched for this event' }, 404);
    }

    // Create run record
    const runId = uuidv4();
    await store.createRun({
      id: runId,
      sopName: sop.name,
      eventSource: event.source,
      eventType: event.type,
      status: 'queued',
      triggerEvent: event as unknown as Record<string, unknown>,
    });

    // Dispatch to queue
    await queue.dispatch({ runId, event, sop, configPath });

    return c.json({ status: 'accepted', runId, eventId: event.id }, 202);
  });

  // GET /api/run/:runId - get run status
  apiRoutes.get('/run/:runId', async (c) => {
    const runId = c.req.param('runId');
    const run = await store.getRun(runId);

    if (!run) {
      return c.json({ error: `Run ${runId} not found` }, 404);
    }

    return c.json(run);
  });

  app.route('/api', apiRoutes);

  return app;
}
