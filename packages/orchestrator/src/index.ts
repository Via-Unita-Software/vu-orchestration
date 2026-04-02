import { serve } from '@hono/node-server';
import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { loadConfig, loadSops } from '@vu-orchestration/core';
import { DedupService } from './dedup.js';
import { RunQueue } from './queue.js';
import { RunStore, createDb } from './store.js';
import { createServer } from './server.js';

async function main() {
  const configPath = process.env['CONFIG_PATH'] ?? 'config/config.yaml';
  const sopsDir = process.env['SOPS_DIR'] ?? 'sops/';
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const databaseUrl = process.env['DATABASE_URL'] ?? 'postgresql://localhost:5432/viaunita';
  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const apiKey = process.env['API_KEY'];

  console.log(`[orchestrator] Loading config from ${configPath}`);
  const config = await loadConfig(configPath);

  console.log(`[orchestrator] Loading SOPs from ${sopsDir}`);
  const sops = await loadSops(sopsDir);
  console.log(`[orchestrator] Loaded ${sops.length} SOPs: ${sops.map((s) => s.name).join(', ')}`);

  // Connect to Redis
  console.log(`[orchestrator] Connecting to Redis at ${redisUrl}`);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  // Connect to PostgreSQL
  console.log(`[orchestrator] Connecting to PostgreSQL`);
  const pool = new Pool({ connectionString: databaseUrl });
  const db = createDb(pool);

  // Initialize services
  const dedup = new DedupService(redis);
  const runQueue = new RunQueue(redis);
  const store = new RunStore(db);

  // No trigger adapters registered by default — they are registered externally
  const adapters = new Map();

  const app = createServer({
    config,
    sops,
    adapters,
    queue: runQueue,
    dedup,
    store,
    configPath,
    apiKey,
  });

  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`[orchestrator] Server running on http://localhost:${info.port}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[orchestrator] Shutting down...');
    await runQueue.close();
    await redis.quit();
    await pool.end();
    server.close(() => {
      console.log('[orchestrator] Server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[orchestrator] Fatal error:', err);
  process.exit(1);
});
